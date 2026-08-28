import * as SecureStore from 'expo-secure-store'

import { Q } from '@nozbe/watermelondb'

import { getDeviceId, getDeviceName } from './deviceId'
import { secureStoreGetLarge, secureStoreRemoveLarge, secureStoreSetLarge } from './secureStoreLarge'
import type { ShopkeeperSession, ShopkeeperStockAccessStatus, StockAccessType } from '../types'
import { database } from '../database'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'
import type ProductModel from '../database/models/Product'
import type StockMovementModel from '../database/models/StockMovement'
import type ActivityLogModel from '../database/models/ActivityLog'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'
import {
  mergeRemoteProductsIntoWatermelon,
  mergeRemoteSalesAndItemsIntoWatermelon,
  type SupabaseProductRow,
  type SupabaseSaleItemRow,
  type SupabaseSaleRow,
} from './sync'
import { getLocalCalendarMonthBoundsIso } from './calendarMonth'
import { isSessionSupersededResponse } from './activeSession'
import { wmRaw } from './watermelonRaw'
import { logStaffSaleNotify } from './staffSaleNotifyDebug'

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
  skShopId: 'pp_sk_sess_sk_shop_id',
  skShopLabel: 'pp_sk_sess_sk_shop_label',
} as const

function receiptSuffixFromPayload(sk: Record<string, unknown>): string {
  const raw = sk.receiptSuffix ?? sk.receipt_suffix
  return String(raw ?? '')
    .trim()
    .toUpperCase()
}

function shopIdFromPayload(sk: Record<string, unknown>): string | null {
  const raw = sk.shopId ?? sk.shop_id
  const id = String(raw ?? '').trim()
  return id.length > 0 ? id : null
}

function shopLabelFromPayload(sk: Record<string, unknown>): string | null {
  const raw = sk.shopLabel ?? sk.shop_label
  const label = String(raw ?? '').trim()
  return label.length > 0 ? label : null
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
    shop_id?: string | null
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
  activity_log?: {
    id: string
    action: 'sale_completed'
    entity_type: 'sale'
    entity_id: string
    entity_name: string
    details: {
      totalCents: number
      itemCount: number
      paymentMethod: string
      receiptNumber: string
      staffName?: string
    }
    created_at: string
  }
}

export async function pushShopkeeperSaleRemote(
  sessionToken: string,
  payload: ShopkeeperSalePushPayload,
): Promise<{ ok: boolean; message?: string }> {
  const body: Record<string, unknown> = {
    action: 'push_sale',
    sessionToken,
    sale: payload.sale,
    sale_items: payload.sale_items,
  }
  if (payload.stock_movements != null && payload.stock_movements.length > 0) {
    body.stock_movements = payload.stock_movements
  }
  if (payload.activity_log != null) {
    body.activity_log = payload.activity_log
  }

  logStaffSaleNotify('shopkeeper.push_sale.request', {
    saleId: payload.sale.id,
    receipt: payload.sale.receipt_number,
    itemCount: payload.sale_items.length,
    hasActivityLog: payload.activity_log != null,
    activityLogId: payload.activity_log?.id ?? null,
    productIds: payload.sale_items.map((it) => it.product_id),
  })

  const data = await callShopkeeperAuth(body)
  const ok = data.status === 'ok'
  const message = data.message != null ? String(data.message) : undefined

  logStaffSaleNotify(
    ok ? 'shopkeeper.push_sale.ok' : 'shopkeeper.push_sale.failed',
    ok
      ? { saleId: payload.sale.id }
      : {
          saleId: payload.sale.id,
          status: data.status,
          message: message ?? null,
        },
  )

  return { ok, message }
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

export type ShopkeeperStockAdjustmentPushPayload = {
  product_patch: ShopkeeperProductPatchPayload
  stock_movement: ShopkeeperStockMovementPushRow
  activity_log: {
    id: string
    action: 'stock_adjusted'
    entity_type: 'stock_movement'
    entity_id: string
    entity_name: string
    details: { qtyChange: number; reason: string; unit?: string; staffName?: string }
    created_at: string
  }
}

/** Push stock adjustment + movement + activity log; notifies owner server-side. */
export async function pushShopkeeperStockAdjustmentRemote(
  sessionToken: string,
  payload: ShopkeeperStockAdjustmentPushPayload,
): Promise<boolean> {
  const data = await callShopkeeperAuth({
    action: 'push_stock_adjustment',
    sessionToken,
    ...payload,
  })
  return data.status === 'ok'
}

export type ShopkeeperStockReceivedPushPayload = {
  product_patch: ShopkeeperProductPatchPayload
  stock_movement: ShopkeeperStockMovementPushRow
  activity_log: {
    id: string
    action: 'stock_received'
    entity_type: 'stock_movement'
    entity_id: string
    entity_name: string
    details: { qty: number; unit?: string; supplier?: string; staffName?: string }
    created_at: string
  }
}

/** Push stock received + movement + activity log; notifies owner server-side. */
export async function pushShopkeeperStockReceivedRemote(
  sessionToken: string,
  payload: ShopkeeperStockReceivedPushPayload,
): Promise<boolean> {
  const data = await callShopkeeperAuth({
    action: 'push_stock_received',
    sessionToken,
    ...payload,
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

type PendingStockAdjustment = {
  movementId: string
  activityLogId: string
}

function pendingAdjustmentsKey(businessId: string): string {
  return `pp_sk_pending_adjustments_${businessId}`
}

function pendingReceivedKey(businessId: string): string {
  return `pp_sk_pending_received_${businessId}`
}

async function readPendingAdjustments(key: string): Promise<PendingStockAdjustment[]> {
  try {
    const raw = await SecureStore.getItemAsync(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is PendingStockAdjustment =>
        x != null &&
        typeof x === 'object' &&
        typeof (x as PendingStockAdjustment).movementId === 'string' &&
        typeof (x as PendingStockAdjustment).activityLogId === 'string',
    )
  } catch {
    return []
  }
}

async function writePendingAdjustments(
  key: string,
  items: PendingStockAdjustment[],
): Promise<void> {
  if (items.length === 0) {
    await SecureStore.deleteItemAsync(key).catch(() => {})
    return
  }
  await SecureStore.setItemAsync(key, JSON.stringify(items.slice(-60)))
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

/** Queue a staff stock adjustment for retry when `push_stock_adjustment` could not reach the server. */
export async function enqueuePendingShopkeeperStockAdjustment(
  businessId: string,
  movementId: string,
  activityLogId: string,
): Promise<void> {
  const key = pendingAdjustmentsKey(businessId)
  const items = await readPendingAdjustments(key)
  if (!items.some((x) => x.movementId === movementId)) {
    items.push({ movementId, activityLogId })
  }
  await writePendingAdjustments(key, items)
}

async function removePendingShopkeeperStockAdjustment(
  businessId: string,
  movementId: string,
): Promise<void> {
  const key = pendingAdjustmentsKey(businessId)
  const items = (await readPendingAdjustments(key)).filter((x) => x.movementId !== movementId)
  await writePendingAdjustments(key, items)
}

/** Queue a staff stock receive for retry when `push_stock_received` could not reach the server. */
export async function enqueuePendingShopkeeperStockReceived(
  businessId: string,
  movementId: string,
  activityLogId: string,
): Promise<void> {
  const key = pendingReceivedKey(businessId)
  const items = await readPendingAdjustments(key)
  if (!items.some((x) => x.movementId === movementId)) {
    items.push({ movementId, activityLogId })
  }
  await writePendingAdjustments(key, items)
}

async function removePendingShopkeeperStockReceived(
  businessId: string,
  movementId: string,
): Promise<void> {
  const key = pendingReceivedKey(businessId)
  const items = (await readPendingAdjustments(key)).filter((x) => x.movementId !== movementId)
  await writePendingAdjustments(key, items)
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
    const createdAtIso = new Date(createdMs).toISOString()

    let activityLog: ShopkeeperSalePushPayload['activity_log'] = {
      id: `${saleId}_log`,
      action: 'sale_completed',
      entity_type: 'sale',
      entity_id: saleId,
      entity_name: saleRow.receiptNumber,
      details: {
        totalCents: saleRow.totalCents,
        itemCount: itemRows.length,
        paymentMethod: saleRow.paymentMethod,
        receiptNumber: saleRow.receiptNumber,
      },
      created_at: createdAtIso,
    }

    try {
      const logs = await database
        .get<ActivityLogModel>('activity_logs')
        .query(Q.and(Q.where('entity_id', saleId), Q.where('action', 'sale_completed')))
        .fetch()
      if (logs.length > 0) {
        const log = logs[0]
        let details = activityLog.details
        if (log.details) {
          try {
            const parsed = JSON.parse(log.details) as Record<string, unknown>
            details = {
              totalCents: Number(parsed.totalCents ?? saleRow.totalCents),
              itemCount: Number(parsed.itemCount ?? itemRows.length),
              paymentMethod: String(parsed.paymentMethod ?? saleRow.paymentMethod),
              receiptNumber: String(parsed.receiptNumber ?? saleRow.receiptNumber),
              staffName: parsed.staffName != null ? String(parsed.staffName) : undefined,
            }
          } catch {
            /* keep sale-derived details */
          }
        }
        activityLog = {
          id: log.id,
          action: 'sale_completed',
          entity_type: 'sale',
          entity_id: saleId,
          entity_name: log.entityName || saleRow.receiptNumber,
          details,
          created_at: new Date(log.createdAt.getTime()).toISOString(),
        }
      }
    } catch {
      /* activity log optional for rebuild */
    }

    return {
      sale: {
        id: saleRow.id,
        business_id: saleRow.businessId,
        total_cents: saleRow.totalCents,
        discount_cents: saleRow.discountCents,
        payment_method: saleRow.paymentMethod,
        receipt_number: saleRow.receiptNumber,
        note: saleRow.note ?? null,
        created_at: createdAtIso,
        shop_id: saleRow.shopId ?? null,
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
        created_at: createdAtIso,
      })),
      activity_log: activityLog,
    }
  } catch {
    return null
  }
}

async function buildShopkeeperStockAdjustmentPayloadFromLocal(
  movementId: string,
  activityLogId: string,
  shopkeeperId: string,
): Promise<ShopkeeperStockAdjustmentPushPayload | null> {
  if (!database) return null
  try {
    const movement = await database.get<StockMovementModel>('stock_movements').find(movementId)
    if (movement.action !== 'adjustment') return null

    const product = await database.get<ProductModel>('products').find(movement.productId)
    const updatedMs = wmRaw(product).updated_at as number
    const movementMs =
      movement.createdAt instanceof Date ? movement.createdAt.getTime() : Date.now()

    let details: { qtyChange: number; reason: string; unit?: string; staffName?: string } = {
      qtyChange: movement.qtyChange,
      reason: movement.reason ?? '',
      unit: product.unit,
    }
    let entityName = movement.productNameSnapshot || product.name
    let createdAt = new Date(movementMs).toISOString()

    try {
      const log = await database.get<ActivityLogModel>('activity_logs').find(activityLogId)
      if (log.action === 'stock_adjusted' && log.actorId === shopkeeperId) {
        entityName = log.entityName || entityName
        createdAt = new Date(log.createdAt.getTime()).toISOString()
        if (log.details) {
          try {
            const parsed = JSON.parse(log.details) as Record<string, unknown>
            details = {
              qtyChange: Number(parsed.qtyChange ?? movement.qtyChange),
              reason: String(parsed.reason ?? movement.reason),
              unit: parsed.unit != null ? String(parsed.unit) : product.unit,
              staffName:
                parsed.staffName != null ? String(parsed.staffName) : undefined,
            }
          } catch {
            /* keep movement-derived details */
          }
        }
      }
    } catch {
      /* activity log optional for rebuild */
    }

    return {
      product_patch: {
        product_id: product.id,
        stock_qty: product.stockQty,
        updated_at: new Date(updatedMs).toISOString(),
      },
      stock_movement: {
        id: movement.id,
        business_id: movement.businessId,
        product_id: movement.productId,
        product_name_snapshot: movement.productNameSnapshot || product.name,
        action: 'adjustment',
        qty_change: movement.qtyChange,
        reason: movement.reason || null,
        supplier: movement.supplier ?? '',
        created_at: new Date(movementMs).toISOString(),
      },
      activity_log: {
        id: activityLogId,
        action: 'stock_adjusted',
        entity_type: 'stock_movement',
        entity_id: movement.productId,
        entity_name: entityName,
        details,
        created_at: createdAt,
      },
    }
  } catch {
    return null
  }
}

async function buildShopkeeperStockReceivedPayloadFromLocal(
  movementId: string,
  activityLogId: string,
  shopkeeperId: string,
): Promise<ShopkeeperStockReceivedPushPayload | null> {
  if (!database) return null
  try {
    const movement = await database.get<StockMovementModel>('stock_movements').find(movementId)
    if (movement.action !== 'purchase') return null

    const product = await database.get<ProductModel>('products').find(movement.productId)
    const updatedMs = wmRaw(product).updated_at as number
    const movementMs =
      movement.createdAt instanceof Date ? movement.createdAt.getTime() : Date.now()

    let details: { qty: number; unit?: string; supplier?: string; staffName?: string } = {
      qty: movement.qtyChange,
      unit: product.unit,
      supplier: movement.supplier || undefined,
    }
    let entityName = movement.productNameSnapshot || product.name
    let createdAt = new Date(movementMs).toISOString()

    const patch: ShopkeeperProductPatchPayload = {
      product_id: product.id,
      stock_qty: product.stockQty,
      updated_at: new Date(updatedMs).toISOString(),
    }
    if (product.costPriceCents != null) {
      patch.cost_price_cents = product.costPriceCents
    }

    try {
      const log = await database.get<ActivityLogModel>('activity_logs').find(activityLogId)
      if (log.action === 'stock_received' && log.actorId === shopkeeperId) {
        entityName = log.entityName || entityName
        createdAt = new Date(log.createdAt.getTime()).toISOString()
        if (log.details) {
          try {
            const parsed = JSON.parse(log.details) as Record<string, unknown>
            details = {
              qty: Number(parsed.qty ?? movement.qtyChange),
              unit: parsed.unit != null ? String(parsed.unit) : product.unit,
              supplier:
                parsed.supplier != null
                  ? String(parsed.supplier)
                  : movement.supplier || undefined,
              staffName:
                parsed.staffName != null ? String(parsed.staffName) : undefined,
            }
          } catch {
            /* keep movement-derived details */
          }
        }
      }
    } catch {
      /* activity log optional for rebuild */
    }

    return {
      product_patch: patch,
      stock_movement: {
        id: movement.id,
        business_id: movement.businessId,
        product_id: movement.productId,
        product_name_snapshot: movement.productNameSnapshot || product.name,
        action: 'purchase',
        qty_change: movement.qtyChange,
        reason: movement.reason || null,
        supplier: movement.supplier ?? '',
        created_at: new Date(movementMs).toISOString(),
      },
      activity_log: {
        id: activityLogId,
        action: 'stock_received',
        entity_type: 'stock_movement',
        entity_id: movement.productId,
        entity_name: entityName,
        details,
        created_at: createdAt,
      },
    }
  } catch {
    return null
  }
}

function pendingSaleFailuresKey(businessId: string): string {
  return `pp_sk_pending_sale_failures_${businessId}`
}

async function readSalePushFailureCounts(
  businessId: string,
): Promise<Record<string, number>> {
  const raw = await SecureStore.getItemAsync(pendingSaleFailuresKey(businessId))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeSalePushFailureCounts(
  businessId: string,
  counts: Record<string, number>,
): Promise<void> {
  const keys = Object.keys(counts)
  if (keys.length === 0) {
    await SecureStore.deleteItemAsync(pendingSaleFailuresKey(businessId)).catch(() => {})
    return
  }
  await SecureStore.setItemAsync(pendingSaleFailuresKey(businessId), JSON.stringify(counts))
}

async function clearSalePushFailureCount(businessId: string, saleId: string): Promise<void> {
  const counts = await readSalePushFailureCounts(businessId)
  if (!(saleId in counts)) return
  delete counts[saleId]
  await writeSalePushFailureCounts(businessId, counts)
}

const MAX_SALE_PUSH_ATTEMPTS = 5

async function recordSalePushFailure(
  businessId: string,
  saleId: string,
  message: string | undefined,
): Promise<boolean> {
  const counts = await readSalePushFailureCounts(businessId)
  const next = (counts[saleId] ?? 0) + 1
  counts[saleId] = next
  await writeSalePushFailureCounts(businessId, counts)

  if (next >= MAX_SALE_PUSH_ATTEMPTS) {
    await removePendingShopkeeperSaleId(businessId, saleId)
    delete counts[saleId]
    await writeSalePushFailureCounts(businessId, counts)
    logStaffSaleNotify('shopkeeper.push_sale.dropped_from_queue', {
      saleId,
      attempts: next,
      message: message ?? null,
    })
    return true
  }

  return false
}

let flushOutboundInFlight: Promise<void> | null = null

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
  if (flushOutboundInFlight) return flushOutboundInFlight

  flushOutboundInFlight = (async () => {
    const saleIds = await readStringIdList(pendingSalesKey(businessId))
    for (const saleId of saleIds) {
      const payload = await buildShopkeeperSalePayloadFromLocal(saleId, shopkeeperId)
      if (!payload) {
        await removePendingShopkeeperSaleId(businessId, saleId)
        await clearSalePushFailureCount(businessId, saleId)
        continue
      }
      const { ok, message } = await pushShopkeeperSaleRemote(sessionToken, payload)
      if (ok) {
        await removePendingShopkeeperSaleId(businessId, saleId)
        await clearSalePushFailureCount(businessId, saleId)
      } else {
        await recordSalePushFailure(businessId, saleId, message)
      }
    }

  const pendingAdjustments = await readPendingAdjustments(pendingAdjustmentsKey(businessId))
  for (const pending of pendingAdjustments) {
    const payload = await buildShopkeeperStockAdjustmentPayloadFromLocal(
      pending.movementId,
      pending.activityLogId,
      shopkeeperId,
    )
    if (!payload) {
      await removePendingShopkeeperStockAdjustment(businessId, pending.movementId)
      continue
    }
    const ok = await pushShopkeeperStockAdjustmentRemote(sessionToken, payload)
    if (ok) await removePendingShopkeeperStockAdjustment(businessId, pending.movementId)
  }

  const pendingReceived = await readPendingAdjustments(pendingReceivedKey(businessId))
  for (const pending of pendingReceived) {
    const payload = await buildShopkeeperStockReceivedPayloadFromLocal(
      pending.movementId,
      pending.activityLogId,
      shopkeeperId,
    )
    if (!payload) {
      await removePendingShopkeeperStockReceived(businessId, pending.movementId)
      continue
    }
    const ok = await pushShopkeeperStockReceivedRemote(sessionToken, payload)
    if (ok) await removePendingShopkeeperStockReceived(businessId, pending.movementId)
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
  })().finally(() => {
    flushOutboundInFlight = null
  })

  return flushOutboundInFlight
}

export async function pullShopkeeperCloudSnapshotFast(
  sessionToken: string,
  businessId: string,
  shopkeeperId: string,
  opts?: { authoritativeProducts?: boolean; flushOutbound?: boolean },
): Promise<void> {
  if (opts?.flushOutbound === true) {
    await flushPendingShopkeeperOutbound(sessionToken, businessId, shopkeeperId).catch(() => {})
  }

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
  await SecureStore.setItemAsync(SK.skShopId, sk.shopId ?? '')
  await SecureStore.setItemAsync(SK.skShopLabel, sk.shopLabel ?? '')
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
  const skShopIdRaw = parts[SK.skShopId]
  const skShopLabelRaw = parts[SK.skShopLabel]

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
      shopId: skShopIdRaw && skShopIdRaw.length > 0 ? skShopIdRaw : null,
      shopLabel: skShopLabelRaw && skShopLabelRaw.length > 0 ? skShopLabelRaw : null,
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
        shopId: shopIdFromPayload(rawShopkeeper),
        shopLabel: shopLabelFromPayload(rawShopkeeper),
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
    await pullShopkeeperCloudSnapshotFast(session.sessionToken, session.businessId, session.shopkeeper.id, {
      authoritativeProducts: true,
      flushOutbound: true,
    }).catch(
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
        shopId: shopIdFromPayload(rawShopkeeper),
        shopLabel: shopLabelFromPayload(rawShopkeeper),
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
    await pullShopkeeperCloudSnapshotFast(session.sessionToken, session.businessId, session.shopkeeper.id, {
      authoritativeProducts: true,
      flushOutbound: true,
    }).catch(
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
    if (isSessionSupersededResponse(data)) {
      await clearShopkeeperSession()
      return null
    }
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
      const nextShopId = shopIdFromPayload(rawSk)
      const nextShopLabel = shopLabelFromPayload(rawSk)
      const suffixChanged = nextSuffix !== sessionOut.shopkeeper.receiptSuffix
      const shopChanged =
        nextShopId !== (sessionOut.shopkeeper.shopId ?? null) ||
        nextShopLabel !== (sessionOut.shopkeeper.shopLabel ?? null)
      if (suffixChanged || shopChanged) {
        sessionOut = {
          ...sessionOut,
          shopkeeper: {
            ...sessionOut.shopkeeper,
            receiptSuffix: nextSuffix,
            shopId: nextShopId,
            shopLabel: nextShopLabel,
          },
        }
        if (suffixChanged) await SecureStore.setItemAsync(SK.skReceiptSuffix, nextSuffix)
        if (shopChanged) {
          await SecureStore.setItemAsync(SK.skShopId, nextShopId ?? '')
          await SecureStore.setItemAsync(SK.skShopLabel, nextShopLabel ?? '')
        }
      }
    }

    await pullShopkeeperCloudSnapshotFast(
      sessionOut.sessionToken,
      sessionOut.businessId,
      sessionOut.shopkeeper.id,
      { authoritativeProducts: true, flushOutbound: true },
    ).catch(() => {})
    return sessionOut
  } catch {
    return null
  }
}

/** Returns the sessionId embedded in a shopkeeper JWT, if present. */
export function shopkeeperSessionIdFromToken(sessionToken: string): string | null {
  try {
    const parts = sessionToken.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1])) as { sessionId?: unknown }
    return typeof payload.sessionId === 'string' && payload.sessionId.length > 0
      ? payload.sessionId
      : null
  } catch {
    return null
  }
}

/** Returns true when the server reports this shopkeeper session was replaced. */
export async function verifyShopkeeperSessionActive(): Promise<boolean> {
  const session = await readSessionFromKeys()
  if (!session?.sessionToken) return false

  try {
    const data = await callShopkeeperAuth({
      action: 'verify_token',
      sessionToken: session.sessionToken,
    })
    return isSessionSupersededResponse(data)
  } catch {
    return false
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

export async function checkShopkeeperStockAccess(
  sessionToken: string,
  accessType: StockAccessType,
): Promise<ShopkeeperStockAccessStatus> {
  try {
    const data = await callShopkeeperAuth({
      action: 'check_stock_access',
      sessionToken,
      accessType,
    })
    if (data.status === 'granted') return 'granted'
    if (data.status === 'pending') return 'pending'
    if (data.status === 'denied') return 'denied'
  } catch {
    return 'none'
  }
  return 'none'
}

export async function requestShopkeeperStockAccess(
  sessionToken: string,
  accessType: StockAccessType,
): Promise<ShopkeeperStockAccessStatus> {
  try {
    const data = await callShopkeeperAuth({
      action: 'request_stock_access',
      sessionToken,
      accessType,
    })
    if (data.status === 'granted') return 'granted'
    if (data.status === 'pending') return 'pending'
    if (data.status === 'denied') return 'denied'
  } catch {
    return 'none'
  }
  return 'pending'
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
