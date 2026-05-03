import * as SecureStore from 'expo-secure-store'

import { getDeviceId, getDeviceName } from './deviceId'
import { secureStoreGetLarge, secureStoreRemoveLarge, secureStoreSetLarge } from './secureStoreLarge'
import type { ShopkeeperSession } from '../types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'
import {
  mergeRemoteProductsIntoWatermelon,
  mergeRemoteSalesAndItemsIntoWatermelon,
  type SupabaseProductRow,
  type SupabaseSaleItemRow,
  type SupabaseSaleRow,
} from './sync'
import { getLocalCalendarMonthBoundsIso } from './calendarMonth'

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/shopkeeper-auth`

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
export async function pullShopkeeperProductsIntoLocalDb(sessionToken: string): Promise<number> {
  const data = await callShopkeeperAuth({
    action: 'pull_products',
    sessionToken,
  })
  if (data.status === 'error') {
    if (__DEV__) console.warn('[shopkeeper] pull_products:', data.message)
    return 0
  }
  if (data.status !== 'ok' || !Array.isArray(data.products)) return 0
  return mergeRemoteProductsIntoWatermelon(data.products as SupabaseProductRow[])
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
export async function pullAllShopkeeperData(sessionToken: string): Promise<void> {
  await pullShopkeeperProductsIntoLocalDb(sessionToken).catch(() => {})
  await pullShopkeeperSalesForCurrentMonth(sessionToken).catch(() => {})
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
}

/** Persist a shopkeeper-recorded sale + items to Supabase (service role via edge). */
export async function pushShopkeeperSaleRemote(
  sessionToken: string,
  payload: ShopkeeperSalePushPayload,
): Promise<boolean> {
  const data = await callShopkeeperAuth({
    action: 'push_sale',
    sessionToken,
    sale: payload.sale,
    sale_items: payload.sale_items,
  })
  return data.status === 'ok'
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
    await pullAllShopkeeperData(session.sessionToken).catch(() => {})
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
    await pullAllShopkeeperData(session.sessionToken).catch(() => {})
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

    await pullAllShopkeeperData(sessionOut.sessionToken).catch(() => {})
    return sessionOut
  } catch {
    return null
  }
}

export async function clearShopkeeperSession(): Promise<void> {
  await secureStoreRemoveLarge(TOKEN_STORAGE_KEY)
  await Promise.all(
    SCALAR_SESSION_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})),
  )
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY).catch(() => {})
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
