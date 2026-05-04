import * as SecureStore from 'expo-secure-store'

import { Q } from '@nozbe/watermelondb'

import { getDeviceId, getDeviceName } from './deviceId'
import { secureStoreGetLarge, secureStoreRemoveLarge, secureStoreSetLarge } from './secureStoreLarge'
import type { ShopkeeperSession } from '../types'
import { database } from '../database'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'
import type ProductModel from '../database/models/Product'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'
import {
  mergeRemoteProductsIntoWatermelon,
  mergeRemoteSalesAndItemsIntoWatermelon,
  type SupabaseProductRow,
  type SupabaseSaleItemRow,
  type SupabaseSaleRow,
} from './sync'
import { getLocalCalendarMonthBoundsIso } from './calendarMonth'
import { wmRaw } from './watermelonRaw'

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/shopkeeper-auth`

/**
 * In-memory cursor tracking the last successful incremental product pull.
 * 0 = never pulled this session → triggers a full pull (no `since`).
 * Reset to 0 if the session changes (login/logout resets the module state naturally).
 *
 * A 30-second lookback window is subtracted when building the `since` timestamp to
 * guard against server-side clock skew, replication lag, and network round-trip time.
 * Wider than the 3-second poll interval to ensure no update window is ever missed.
 */
let lastSkProductSyncMs = 0
const SK_PRODUCT_LOOKBACK_MS = 30_000

/** ISO `since` string for the next incremental product poll, or null for a full pull. */
function skProductSinceIso(): string | null {
  if (lastSkProductSyncMs === 0) return null
  return new Date(lastSkProductSyncMs - SK_PRODUCT_LOOKBACK_MS).toISOString()
}

/** Call after every successful product pull to advance the cursor. */
function markSkProductSynced(): void {
  lastSkProductSyncMs = Date.now()
}

/**
 * In-memory timestamp of the last sales pull. Background polls only re-pull sales every
 * 30 seconds — the shopkeeper's own sales are already local, so frequent pulls waste bandwidth.
 */
let lastSkSalesPullMs = 0
const SK_SALES_BG_INTERVAL_MS = 30_000

/** Legacy single-blob key (migrated on read) */
const LEGACY_SESSION_KEY = 'shopkeeper_session'

const SK = {
  token: 'pp_sk_sess_token',
  businessId: 'pp_sk_sess_business_id',
  businessName: 'pp_sk_sess_business_name',
  deviceId: 'pp_sk_sess_device_id',
  isApproved: 'pp_sk_sess_is_approved',
  skId: 'pp_sk_sess_sk_id',
  skBusinessId: 'pp_sk_sess_sk_business_id',
  skSupabaseId: 'pp_sk_sess_sk_supabase_id',
  skUsername: 'pp_sk_sess_sk_username',
  skFullName: 'pp_sk_sess_sk_full_name',
  skPhone: 'pp_sk_sess_sk_phone',
  skIsActive: 'pp_sk_sess_sk_is_active',
  skCreatedAt: 'pp_sk_sess_sk_created_at',
  skUpdatedAt: 'pp_sk_sess_sk_updated_at',
  skReceiptSuffix: 'pp_sk_sess_sk_receipt_suffix',
} as const

function receiptSuffixFromPayload(sk: Record<string, unknown>): string {
  const raw = sk.receiptSuffix ?? sk.receipt_suffix
  return String(raw ?? '')
    .trim()
    .toUpperCase()
}

const TOKEN_STORAGE_KEY = SK.token
const SCALAR_SESSION_KEYS = Object.values(SK).filter((k) => k !== TOKEN_STORAGE_KEY)

type LoginResult = {
  status: 'approved' | 'pending_approval' | 'error'
  session?: ShopkeeperSession
  message?: string
}

async function callShopkeeperAuth(body: Record<string, unknown>) {
  let res: Response
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    const msg =
      e instanceof TypeError && e.message === 'Network request failed'
        ? 'Could not reach the server. Check your internet connection and that the app is pointed at the correct Supabase project.'
        : (e as Error)?.message ?? 'Network error'
    throw new Error(msg)
  }

  const text = await res.text()
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(
      text.trim().slice(0, 200) || `Shopkeeper auth returned an invalid response (${res.status})`,
    )
  }
}

/** Pull products from Supabase via edge function (shopkeepers have no owner JWT for RLS reads). */
export async function pullShopkeeperProductsIntoLocalDb(
  sessionToken: string,
  mergeOptions?: { authoritative?: boolean },
  since?: string,
): Promise<number> {
  const data = await callShopkeeperAuth({
    action: 'pull_products',
    sessionToken,
    ...(since != null ? { since } : {}),
  })
  if (data.status === 'error') {
    if (__DEV__) console.warn('[shopkeeper] pull_products:', data.message)
    return 0
  }
  if (data.status !== 'ok' || !Array.isArray(data.products)) return 0
  const count = await mergeRemoteProductsIntoWatermelon(data.products as SupabaseProductRow[], mergeOptions)
  markSkProductSynced()
  return count
}

/** Pull this shopkeeper's sales for the current local calendar month + line items. */
export async function pullShopkeeperSalesForCurrentMonth(sessionToken: string): Promise<number> {
  const { monthStartIso, monthEndIso } = getLocalCalendarMonthBoundsIso()
  const data = await callShopkeeperAuth({
    action: 'pull_sales_month',
    sessionToken,
    monthStartIso,
    monthEndIso,
  })
  if (data.status === 'error') {
    if (__DEV__) console.warn('[shopkeeper] pull_sales_month:', data.message)
    return 0
  }
  if (data.status !== 'ok') return 0
  const sales = Array.isArray(data.sales) ? data.sales : []
  const sale_items = Array.isArray(data.sale_items) ? data.sale_items : []
  return mergeRemoteSalesAndItemsIntoWatermelon(
    sales as SupabaseSaleRow[],
    sale_items as SupabaseSaleItemRow[],
  )
}

/** Products + current-month sales (shopkeeper has no owner JWT sync). */
export async function pullAllShopkeeperData(
  sessionToken: string,
  opts?: { authoritativeProducts?: boolean },
): Promise<void> {
  const mergeOpts =
    opts?.authoritativeProducts === true ? { authoritative: true as const } : undefined
  await pullShopkeeperProductsIntoLocalDb(sessionToken, mergeOpts).catch(() => {})
  await pullShopkeeperSalesForCurrentMonth(sessionToken).catch(() => {})
}

export type ShopkeeperStockMovementPushRow = {
  id: string
  business_id: string
  product_id: string
  product_name_snapshot: string
  action: string
  qty_change: number
  reason: string | null
  supplier: string
  created_at: string
}

export type ShopkeeperSalePushPayload = {
  sale: {
    id: string
    business_id: string
    total_cents: number
    discount_cents: number
    payment_method: string
    receipt_number: string
    note: string | null
    created_at: string
  }
  sale_items: Array<{
    id: string
    sale_id: string
    product_id: string
    product_name_snapshot: string
    qty: number
    unit_price_cents: number
    cost_price_cents: number
  }>
  /** Mirrors owner `syncStockMovements` — same Supabase `stock_movements` rows. */
  stock_movements?: ShopkeeperStockMovementPushRow[]
}

export async function pushShopkeeperSaleRemote(
  sessionToken: string,
  payload: ShopkeeperSalePushPayload,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    action: 'push_sale',
    sessionToken,
    sale: payload.sale,
    sale_items: payload.sale_items,
  }
  if (payload.stock_movements != null && payload.stock_movements.length > 0) {
    body.stock_movements = payload.stock_movements
  }
  const data = await callShopkeeperAuth(body)
  return data.status === 'ok'
}

export type ShopkeeperProductPatchPayload = {
  product_id: string
  stock_qty: number
  updated_at: string
  cost_price_cents?: number | null
}

/** Push product stock (and optional cost) after shopkeeper adjustment/receive — mirrors owner direct Supabase updates. */
export async function pushShopkeeperProductPatchesRemote(
  sessionToken: string,
  patches: ShopkeeperProductPatchPayload[],
): Promise<boolean> {
  if (patches.length === 0) return true
  const data = await callShopkeeperAuth({
    action: 'patch_products',
    sessionToken,
    patches,
  })
  return data.status === 'ok'
}

// ---------------------------------------------------------------------------
// Offline-first outbound queue (sales + product stock snapshots)
// ---------------------------------------------------------------------------

function pendingSalesKey(businessId: string): string {
  return `pp_sk_pending_sales_${businessId}`
}

function pendingProductSyncKey(businessId: string): string {
  return `pp_sk_pending_product_sync_${businessId}`
}

async function readStringIdList(key: string): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
  } catch {
    return []
  }
}

async function writeStringIdList(key: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await SecureStore.deleteItemAsync(key).catch(() => {})
    return
  }
  await SecureStore.setItemAsync(key, JSON.stringify(ids.slice(-120)))
}

/** Queue a staff sale for retry when `push_sale` could not reach the server (offline). */
export async function enqueuePendingShopkeeperSaleId(
  businessId: string,
  saleId: string,
): Promise<void> {
  const key = pendingSalesKey(businessId)
  const ids = await readStringIdList(key)
  if (!ids.includes(saleId)) ids.push(saleId)
  await writeStringIdList(key, ids)
}

async function removePendingShopkeeperSaleId(
  businessId: string,
  saleId: string,
): Promise<void> {
  const key = pendingSalesKey(businessId)
  const ids = (await readStringIdList(key)).filter((id) => id !== saleId)
  await writeStringIdList(key, ids)
}

/**
 * After a failed `patch_products`, queue product IDs; flush rebuilds patches from the
 * current local Watermelon row so ordering vs pending sales does not matter.
 */
export async function enqueuePendingShopkeeperProductSync(
  businessId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return
  const key = pendingProductSyncKey(businessId)
  const set = new Set(await readStringIdList(key))
  for (const id of productIds) set.add(id)
  await writeStringIdList(key, [...set])
}

async function buildShopkeeperSalePayloadFromLocal(
  saleId: string,
  shopkeeperId: string,
): Promise<ShopkeeperSalePushPayload | null> {
  if (!database) return null
  try {
    const saleRow = await database.get<SaleModel>('sales').find(saleId)
    if (saleRow.createdByShopkeeperId !== shopkeeperId) return null
    const itemRows = await database
      .get<SaleItemModel>('sale_items')
      .query(Q.where('sale_id', saleId))
      .fetch()
    const createdMs =
      saleRow.createdAt instanceof Date ? saleRow.createdAt.getTime() : Date.now()
    return {
      sale: {
        id: saleRow.id,
        business_id: saleRow.businessId,
        total_cents: saleRow.totalCents,
        discount_cents: saleRow.discountCents,
        payment_method: saleRow.paymentMethod,
        receipt_number: saleRow.receiptNumber,
        note: saleRow.note ?? null,
        created_at: new Date(createdMs).toISOString(),
      },
      sale_items: itemRows.map((si) => ({
        id: si.id,
        sale_id: si.saleId,
        product_id: si.productId,
        product_name_snapshot: si.productNameSnapshot,
        qty: si.qty,
        unit_price_cents: si.unitPriceCents,
        cost_price_cents: si.costPriceCents,
      })),
      stock_movements: itemRows.map((si) => ({
        id: `sk_mov_${si.id}`,
        business_id: saleRow.businessId,
        product_id: si.productId,
        product_name_snapshot: si.productNameSnapshot,
        action: 'sale',
        qty_change: -si.qty,
        reason: null,
        supplier: '',
        created_at: new Date(createdMs).toISOString(),
      })),
    }
  } catch {
    return null
  }
}

/**
 * Retry queued staff sales and product stock snapshots. Call after each sale/adjustment
 * and from `useAutoSync` while online — keeps Supabase `sales`, `products`, and
 * `stock_movements` aligned with the owner's sync pipeline once data reaches the server.
 */
export async function flushPendingShopkeeperOutbound(
  sessionToken: string,
  businessId: string,
  shopkeeperId: string,
): Promise<void> {
  const saleIds = await readStringIdList(pendingSalesKey(businessId))
  for (const saleId of saleIds) {
    const payload = await buildShopkeeperSalePayloadFromLocal(saleId, shopkeeperId)
    if (!payload) {
      await removePendingShopkeeperSaleId(businessId, saleId)
      continue
    }
    const ok = await pushShopkeeperSaleRemote(sessionToken, payload)
    if (ok) await removePendingShopkeeperSaleId(businessId, saleId)
  }

  const productIds = await readStringIdList(pendingProductSyncKey(businessId))
  if (productIds.length === 0 || !database) return

  const patches: ShopkeeperProductPatchPayload[] = []
  for (const productId of productIds) {
    try {
      const p = await database.get<ProductModel>('products').find(productId)
      if (p.businessId !== businessId) continue
      const updatedMs = wmRaw(p).updated_at as number
      patches.push({
        product_id: p.id,
        stock_qty: p.stockQty,
        updated_at: new Date(updatedMs).toISOString(),
      })
    } catch {
      /* skip missing product */
    }
  }

  if (patches.length === 0) {
    await SecureStore.deleteItemAsync(pendingProductSyncKey(businessId)).catch(() => {})
    return
  }

  const patched = await pushShopkeeperProductPatchesRemote(sessionToken, patches)
  if (patched) {
    await SecureStore.deleteItemAsync(pendingProductSyncKey(businessId)).catch(() => {})
  }
}

export async function pullShopkeeperCloudSnapshotFast(
  sessionToken: string,
  businessId: string,
  shopkeeperId: string,
  opts?: { authoritativeProducts?: boolean },
): Promise<void> {
  await flushPendingShopkeeperOutbound(sessionToken, businessId, shopkeeperId).catch(() => {})

  const authoritative = opts?.authoritativeProducts === true

  // Reset the incremental cursor before a full authoritative pull so that the
  // very next background poll uses a `since` anchored to THIS pull's timestamp,
  // not a stale value from a previous session.
  if (authoritative) lastSkProductSyncMs = 0

  const since = authoritative ? undefined : (skProductSinceIso() ?? undefined)

  const nowMs = Date.now()
  const salesDue = authoritative || nowMs - lastSkSalesPullMs >= SK_SALES_BG_INTERVAL_MS

  const tasks: Promise<unknown>[] = [
    pullShopkeeperProductsIntoLocalDb(
      sessionToken,
      authoritative ? { authoritative: true } : undefined,
      since,
    ).catch(() => {}),
  ]

  if (salesDue) {
    tasks.push(
      pullShopkeeperSalesForCurrentMonth(sessionToken)
        .then(() => { lastSkSalesPullMs = Date.now() })
        .catch(() => {}),
    )
  }

  await Promise.all(tasks)
}

async function persistShopkeeperSession(session: ShopkeeperSession): Promise<void> {
  if (__DEV__) {
    const tokenBytes = new TextEncoder().encode(session.sessionToken).length
    console.log(`[SecureStore] shopkeeper sessionToken ${tokenBytes} bytes`)
  }

  const sk = session.shopkeeper
  await secureStoreSetLarge(TOKEN_STORAGE_KEY, session.sessionToken)
  await SecureStore.setItemAsync(SK.businessId, session.businessId)
  await SecureStore.setItemAsync(SK.businessName, session.businessName)
  await SecureStore.setItemAsync(SK.deviceId, session.deviceId)
  await SecureStore.setItemAsync(SK.isApproved, session.isApproved ? '1' : '0')
  await SecureStore.setItemAsync(SK.skId, sk.id)
  await SecureStore.setItemAsync(SK.skBusinessId, sk.businessId)
  await SecureStore.setItemAsync(SK.skSupabaseId, sk.supabaseId)
  await SecureStore.setItemAsync(SK.skUsername, sk.username)
  await SecureStore.setItemAsync(SK.skFullName, sk.fullName)
  await SecureStore.setItemAsync(SK.skPhone, sk.phone ?? '')
  await SecureStore.setItemAsync(SK.skIsActive, sk.isActive ? '1' : '0')
  await SecureStore.setItemAsync(SK.skCreatedAt, String(sk.createdAt))
  await SecureStore.setItemAsync(SK.skUpdatedAt, String(sk.updatedAt))
  await SecureStore.setItemAsync(SK.skReceiptSuffix, sk.receiptSuffix ?? '')
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY).catch(() => {})
}

function assembleSession(parts: Record<string, string | null>): ShopkeeperSession | null {
  const token = parts[SK.token]
  const businessId = parts[SK.businessId]
  const businessName = parts[SK.businessName]
  const deviceId = parts[SK.deviceId]
  const isApprovedRaw = parts[SK.isApproved]
  const skId = parts[SK.skId]
  const skBusinessId = parts[SK.skBusinessId]
  const skSupabaseId = parts[SK.skSupabaseId]
  const skUsername = parts[SK.skUsername]
  const skFullName = parts[SK.skFullName]
  const skPhone = parts[SK.skPhone]
  const skIsActiveRaw = parts[SK.skIsActive]
  const skCreatedAtRaw = parts[SK.skCreatedAt]
  const skUpdatedAtRaw = parts[SK.skUpdatedAt]
  const skReceiptSuffixRaw = parts[SK.skReceiptSuffix]

  if (
    !token ||
    !businessId ||
    businessName == null ||
    !deviceId ||
    !skId ||
    !skBusinessId ||
    !skSupabaseId ||
    !skUsername ||
    !skFullName ||
    skCreatedAtRaw == null ||
    skUpdatedAtRaw == null
  ) {
    return null
  }

  const createdAt = Number(skCreatedAtRaw)
  const updatedAt = Number(skUpdatedAtRaw)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null

  return {
    sessionToken: token,
    businessId,
    businessName,
    deviceId,
    isApproved: isApprovedRaw === '1',
    shopkeeper: {
      id: skId,
      businessId: skBusinessId,
      supabaseId: skSupabaseId,
      username: skUsername,
      fullName: skFullName,
      phone: skPhone && skPhone.length > 0 ? skPhone : undefined,
      receiptSuffix: (skReceiptSuffixRaw ?? '').trim().toUpperCase(),
      isActive: skIsActiveRaw === '1',
      createdAt,
      updatedAt,
    },
  }
}

async function readSessionFromKeys(): Promise<ShopkeeperSession | null> {
  const parts: Record<string, string | null> = {}
  parts[SK.token] = await secureStoreGetLarge(TOKEN_STORAGE_KEY)
  for (const key of SCALAR_SESSION_KEYS) {
    parts[key] = await SecureStore.getItemAsync(key)
  }
  return assembleSession(parts)
}

async function readAndMigrateLegacyBlob(): Promise<ShopkeeperSession | null> {
  const legacy = await SecureStore.getItemAsync(LEGACY_SESSION_KEY)
  if (!legacy) return null
  try {
    const session = JSON.parse(legacy) as ShopkeeperSession
    session.shopkeeper.receiptSuffix = session.shopkeeper.receiptSuffix ?? ''
    await persistShopkeeperSession(session)
    return session
  } catch {
    return null
  }
}

export async function shopkeeperLogin(params: {
  businessId: string
  username: string
  password: string
}): Promise<LoginResult> {
  const deviceId = await getDeviceId()
  const deviceName = await getDeviceName()

  const data = await callShopkeeperAuth({
    action: 'login',
    businessId: params.businessId,
    username: params.username,
    password: params.password,
    deviceId,
    deviceName,
  })

  if (data.status === 'error') {
    return { status: 'error', message: String(data.message ?? 'Sign in failed') }
  }

  if (data.status === 'pending_approval') {
    return { status: 'pending_approval', message: String(data.message ?? 'Waiting for approval.') }
  }

  if (data.status === 'approved') {
    const rawShopkeeper = data.shopkeeper as Record<string, unknown>
    const canonicalBusinessId = String(data.businessId ?? '')
    const session: ShopkeeperSession = {
      shopkeeper: {
        id: String(rawShopkeeper.id),
        businessId: String(rawShopkeeper.businessId ?? canonicalBusinessId),
        supabaseId: String(rawShopkeeper.id),
        username: String(rawShopkeeper.username),
        fullName: String(rawShopkeeper.fullName),
        phone: rawShopkeeper.phone ? String(rawShopkeeper.phone) : undefined,
        receiptSuffix: receiptSuffixFromPayload(rawShopkeeper),
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      businessId: canonicalBusinessId,
      businessName: String(data.businessName ?? ''),
      deviceId,
      isApproved: true,
      sessionToken: String(data.sessionToken),
    }

    await persistShopkeeperSession(session)
    await pullShopkeeperCloudSnapshotFast(session.sessionToken, session.businessId, session.shopkeeper.id, { authoritativeProducts: true }).catch(
      () => {},
    )
    return { status: 'approved', session }
  }

  return { status: 'error', message: 'Unexpected response from shopkeeper auth.' }
}

/** After the owner approves this device, establish a session without re-entering password. */
export async function resumeShopkeeperAfterApproval(params: {
  businessId: string
  username: string
  deviceId: string
}): Promise<LoginResult> {
  const data = await callShopkeeperAuth({
    action: 'resume_after_approval',
    businessId: params.businessId,
    username: params.username,
    deviceId: params.deviceId,
  })

  if (data.status === 'error') {
    return { status: 'error', message: String(data.message ?? 'Could not complete sign-in') }
  }

  if (data.status === 'pending_approval') {
    return {
      status: 'pending_approval',
      message: String(data.message ?? 'Still waiting for approval.'),
    }
  }

  if (data.status === 'approved') {
    const rawShopkeeper = data.shopkeeper as Record<string, unknown>
    const canonicalBusinessId = String(data.businessId ?? '')
    const deviceId = params.deviceId
    const session: ShopkeeperSession = {
      shopkeeper: {
        id: String(rawShopkeeper.id),
        businessId: String(rawShopkeeper.businessId ?? canonicalBusinessId),
        supabaseId: String(rawShopkeeper.id),
        username: String(rawShopkeeper.username),
        fullName: String(rawShopkeeper.fullName),
        phone: rawShopkeeper.phone ? String(rawShopkeeper.phone) : undefined,
        receiptSuffix: receiptSuffixFromPayload(rawShopkeeper),
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      businessId: canonicalBusinessId,
      businessName: String(data.businessName ?? ''),
      deviceId,
      isApproved: true,
      sessionToken: String(data.sessionToken),
    }

    await persistShopkeeperSession(session)
    await pullShopkeeperCloudSnapshotFast(session.sessionToken, session.businessId, session.shopkeeper.id, { authoritativeProducts: true }).catch(
      () => {},
    )
    return { status: 'approved', session }
  }

  return { status: 'error', message: 'Unexpected response from shopkeeper auth.' }
}

export async function getStoredShopkeeperSession(): Promise<ShopkeeperSession | null> {
  try {
    let session = await readSessionFromKeys()
    if (!session) {
      session = await readAndMigrateLegacyBlob()
      if (!session) return null
    }

    const data = await callShopkeeperAuth({
      action: 'verify_token',
      sessionToken: session.sessionToken,
    })
    if (data.status !== 'valid') {
      await clearShopkeeperSession()
      return null
    }

    let sessionOut = session
    const canonicalBiz =
      typeof data.businessId === 'string' && data.businessId.length > 0
        ? data.businessId
        : null
    if (canonicalBiz != null && canonicalBiz !== session.businessId) {
      sessionOut = { ...session, businessId: canonicalBiz }
      await SecureStore.setItemAsync(SK.businessId, canonicalBiz)
    }

    const rawSk = data.shopkeeper as Record<string, unknown> | undefined
    if (rawSk && typeof rawSk.id === 'string') {
      const nextSuffix = receiptSuffixFromPayload(rawSk)
      if (nextSuffix !== sessionOut.shopkeeper.receiptSuffix) {
        sessionOut = {
          ...sessionOut,
          shopkeeper: { ...sessionOut.shopkeeper, receiptSuffix: nextSuffix },
        }
        await SecureStore.setItemAsync(SK.skReceiptSuffix, nextSuffix)
      }
    }

    await pullShopkeeperCloudSnapshotFast(
      sessionOut.sessionToken,
      sessionOut.businessId,
      sessionOut.shopkeeper.id,
      { authoritativeProducts: true },
    ).catch(() => {})
    return sessionOut
  } catch {
    return null
  }
}

export async function clearShopkeeperSession(): Promise<void> {
  const bizId = await SecureStore.getItemAsync(SK.businessId)
  await secureStoreRemoveLarge(TOKEN_STORAGE_KEY)
  await Promise.all(
    SCALAR_SESSION_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})),
  )
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY).catch(() => {})
  if (bizId) {
    await SecureStore.deleteItemAsync(pendingSalesKey(bizId)).catch(() => {})
    await SecureStore.deleteItemAsync(pendingProductSyncKey(bizId)).catch(() => {})
  }
}

export async function checkApprovalStatus(params: {
  businessId: string
  username: string
  deviceId: string
}): Promise<'pending' | 'approved' | 'denied'> {
  try {
    const data = await callShopkeeperAuth({
      action: 'check_approval_status',
      businessId: params.businessId,
      username: params.username,
      deviceId: params.deviceId,
    })
    if (data.status === 'approved' || data.status === 'denied') return data.status
  } catch {
    return 'pending'
  }
  return 'pending'
}
