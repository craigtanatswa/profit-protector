import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Q } from '@nozbe/watermelondb'

import { database } from '../database'
import type ShopModel from '../database/models/Shop'
import type ShopkeeperModel from '../database/models/Shopkeeper'
import type SaleModel from '../database/models/Sale'
import type ProductModel from '../database/models/Product'
import type { Shop } from '../types'
import { supabase } from './supabase'
import { wmRaw } from './watermelonRaw'
import { normalizeTrackingMode } from './cutProducts'

export const SHOP_ADDRESS_MAX = 60
export const SHOP_ADDRESS_MIN = 2

const lastShopKey = (businessId: string) => `pp_last_shop_${businessId}`

export function formatShopLabel(shop: Pick<Shop, 'name' | 'address'>): string {
  const address = shop.address.trim()
  return address.length > 0 ? `${shop.name} · ${address}` : shop.name
}

export function shopNameForNumber(shopNumber: number): string {
  return `Shop ${shopNumber}`
}

export function normalizeShopAddress(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function validateShopAddress(raw: string): string | null {
  const address = normalizeShopAddress(raw)
  if (address.length < SHOP_ADDRESS_MIN) return 'Enter a short address so you can tell shops apart'
  if (address.length > SHOP_ADDRESS_MAX) return `Keep the address under ${SHOP_ADDRESS_MAX} characters`
  return null
}

export function mapShopRecord(record: ShopModel): Shop {
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    address: record.address,
    shopNumber: record.shopNumber,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.getTime() : Date.now(),
  }
}

export async function fetchLocalShops(businessId: string): Promise<Shop[]> {
  if (!database || !businessId) return []
  const records = await database
    .get<ShopModel>('shops')
    .query(Q.where('business_id', businessId), Q.sortBy('shop_number', Q.asc))
    .fetch()
  return records.map(mapShopRecord)
}

export type RemoteShopRow = {
  id: string
  business_id: string
  name: string
  address: string
  shop_number: number
  created_at: string
  updated_at: string
}

export function mapRemoteShop(row: RemoteShopRow): Shop {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    address: row.address,
    shopNumber: row.shop_number,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export async function fetchRemoteShops(businessId: string): Promise<Shop[]> {
  const { data, error } = await supabase
    .from('shops')
    .select('id, business_id, name, address, shop_number, created_at, updated_at')
    .eq('business_id', businessId)
    .order('shop_number', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapRemoteShop(row as RemoteShopRow))
}

export async function mergeRemoteShopsIntoWatermelon(
  businessId: string,
  remoteShops: Shop[],
): Promise<void> {
  if (!database) return
  const local = await database
    .get<ShopModel>('shops')
    .query(Q.where('business_id', businessId))
    .fetch()
  const localById = new Map(local.map((row) => [row.id, row]))
  const remoteIds = new Set(remoteShops.map((shop) => shop.id))

  await database.write(async () => {
    for (const shop of remoteShops) {
      const existing = localById.get(shop.id)
      if (existing) {
        const localUpdated =
          existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : 0
        if (
          existing.name === shop.name &&
          existing.address === shop.address &&
          existing.shopNumber === shop.shopNumber &&
          localUpdated >= shop.updatedAt
        ) {
          continue
        }
        await existing.update((record) => {
          record.name = shop.name
          record.address = shop.address
          record.shopNumber = shop.shopNumber
          record.supabaseId = shop.id
          wmRaw(record).updated_at = shop.updatedAt
        })
      } else {
        await database!.get<ShopModel>('shops').create((record) => {
          record._raw.id = shop.id
          record.businessId = shop.businessId
          record.name = shop.name
          record.address = shop.address
          record.shopNumber = shop.shopNumber
          record.supabaseId = shop.id
          wmRaw(record).created_at = shop.createdAt
          wmRaw(record).updated_at = shop.updatedAt
        })
      }
    }

    for (const row of local) {
      if (!remoteIds.has(row.id)) {
        await row.destroyPermanently()
      }
    }
  })
}

async function insertShopRemote(params: {
  id: string
  businessId: string
  name: string
  address: string
  shopNumber: number
  createdAtIso: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('shops').insert({
    id: params.id,
    business_id: params.businessId,
    name: params.name,
    address: params.address,
    shop_number: params.shopNumber,
    created_at: params.createdAtIso,
    updated_at: params.createdAtIso,
  })
  if (error) {
    const msg = error.message ?? 'Could not save shop'
    return { error: msg }
  }
  return { error: null }
}

async function writeShopLocal(params: {
  id: string
  businessId: string
  name: string
  address: string
  shopNumber: number
  now: number
}): Promise<void> {
  if (!database) return
  await database.write(async () => {
    await database!.get<ShopModel>('shops').create((record) => {
      record._raw.id = params.id
      record.businessId = params.businessId
      record.name = params.name
      record.address = params.address
      record.shopNumber = params.shopNumber
      record.supabaseId = params.id
      wmRaw(record).created_at = params.now
      wmRaw(record).updated_at = params.now
    })
  })
}

async function assignUnscopedRecordsToShop(businessId: string, shopId: string): Promise<void> {
  await supabase
    .from('shopkeepers')
    .update({ shop_id: shopId })
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .is('shop_id', null)
  await supabase
    .from('sales')
    .update({ shop_id: shopId })
    .eq('business_id', businessId)
    .is('shop_id', null)
  await supabase
    .from('products')
    .update({ shop_id: shopId })
    .eq('business_id', businessId)
    .is('shop_id', null)

  if (!database) return
  const keepers = await database
    .get<ShopkeeperModel>('shopkeepers')
    .query(Q.where('business_id', businessId), Q.where('shop_id', Q.eq(null)))
    .fetch()
  const sales = await database
    .get<SaleModel>('sales')
    .query(Q.where('business_id', businessId), Q.where('shop_id', Q.eq(null)))
    .fetch()
  const products = await database
    .get<ProductModel>('products')
    .query(Q.where('business_id', businessId), Q.where('shop_id', Q.eq(null)))
    .fetch()
  if (keepers.length === 0 && sales.length === 0 && products.length === 0) return
  const now = Date.now()
  await database.write(async () => {
    for (const keeper of keepers) {
      await keeper.update((record) => {
        record.shopId = shopId
        wmRaw(record).updated_at = now
      })
    }
    for (const sale of sales) {
      await sale.update((record) => {
        record.shopId = shopId
      })
    }
    for (const product of products) {
      await product.update((record) => {
        record.shopId = shopId
        wmRaw(record).updated_at = now
      })
    }
  })
}

export async function cloneShopCatalog(params: {
  businessId: string
  sourceShopId: string
  targetShopId: string
}): Promise<{ cloned: number; error: string | null }> {
  if (!database) return { cloned: 0, error: null }

  let source = await database
    .get<ProductModel>('products')
    .query(Q.where('business_id', params.businessId), Q.where('shop_id', params.sourceShopId))
    .fetch()

  if (source.length === 0) {
    source = await database
      .get<ProductModel>('products')
      .query(Q.where('business_id', params.businessId), Q.where('shop_id', Q.eq(null)))
      .fetch()
  }

  if (source.length === 0) return { cloned: 0, error: null }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const clones = source.map((product) => {
    const id = Crypto.randomUUID()
    return {
      id,
      business_id: params.businessId,
      shop_id: params.targetShopId,
      name: product.name,
      category: product.category,
      unit: product.unit,
      tracking_mode: normalizeTrackingMode(product.trackingMode),
      cost_price_cents: product.costPriceCents,
      selling_price_cents: product.sellingPriceCents,
      stock_qty: product.stockQty,
      low_stock_threshold: product.lowStockThreshold,
      is_active: product.isActive,
      created_at: nowIso,
      updated_at: nowIso,
    }
  })

  const { error } = await supabase.from('products').insert(clones)
  if (error) return { cloned: 0, error: error.message }

  await database.write(async () => {
    for (const row of clones) {
      await database!.get<ProductModel>('products').create((record) => {
        record._raw.id = row.id
        record.businessId = row.business_id
        record.shopId = row.shop_id
        record.name = row.name
        record.category = row.category
        record.unit = row.unit
        record.trackingMode = row.tracking_mode
        record.costPriceCents = row.cost_price_cents
        record.sellingPriceCents = row.selling_price_cents
        record.stockQty = row.stock_qty
        record.lowStockThreshold = row.low_stock_threshold
        record.isActive = row.is_active
        record.supabaseId = row.id
        wmRaw(record).created_at = now
        wmRaw(record).updated_at = now
      })
    }
  })

  return { cloned: clones.length, error: null }
}

export async function createInitialShopPair(params: {
  businessId: string
  currentAddress: string
  newAddress: string
}): Promise<{ shops: Shop[]; error: string | null }> {
  const currentAddress = normalizeShopAddress(params.currentAddress)
  const newAddress = normalizeShopAddress(params.newAddress)
  const currentErr = validateShopAddress(currentAddress)
  if (currentErr) return { shops: [], error: currentErr }
  const newErr = validateShopAddress(newAddress)
  if (newErr) return { shops: [], error: newErr }

  const now = Date.now()
  const createdAtIso = new Date(now).toISOString()
  const shop1Id = Crypto.randomUUID()
  const shop2Id = Crypto.randomUUID()

  const first = await insertShopRemote({
    id: shop1Id,
    businessId: params.businessId,
    name: shopNameForNumber(1),
    address: currentAddress,
    shopNumber: 1,
    createdAtIso,
  })
  if (first.error) return { shops: [], error: first.error }

  const second = await insertShopRemote({
    id: shop2Id,
    businessId: params.businessId,
    name: shopNameForNumber(2),
    address: newAddress,
    shopNumber: 2,
    createdAtIso,
  })
  if (second.error) {
    await supabase.from('shops').delete().eq('id', shop1Id)
    return { shops: [], error: second.error }
  }

  await writeShopLocal({
    id: shop1Id,
    businessId: params.businessId,
    name: shopNameForNumber(1),
    address: currentAddress,
    shopNumber: 1,
    now,
  })
  await writeShopLocal({
    id: shop2Id,
    businessId: params.businessId,
    name: shopNameForNumber(2),
    address: newAddress,
    shopNumber: 2,
    now,
  })

  await assignUnscopedRecordsToShop(params.businessId, shop1Id)
  const cloned = await cloneShopCatalog({
    businessId: params.businessId,
    sourceShopId: shop1Id,
    targetShopId: shop2Id,
  })
  if (cloned.error) {
    console.warn('[shops] clone catalog failed:', cloned.error)
  }

  const shops = await fetchLocalShops(params.businessId)
  return { shops, error: null }
}

export async function addNamedShop(params: {
  businessId: string
  address: string
  existing: Shop[]
}): Promise<{ shop: Shop | null; error: string | null }> {
  const address = normalizeShopAddress(params.address)
  const addressErr = validateShopAddress(address)
  if (addressErr) return { shop: null, error: addressErr }

  const nextNumber =
    params.existing.reduce((max, shop) => Math.max(max, shop.shopNumber), 0) + 1
  const now = Date.now()
  const createdAtIso = new Date(now).toISOString()
  const id = Crypto.randomUUID()
  const name = shopNameForNumber(nextNumber)

  const remote = await insertShopRemote({
    id,
    businessId: params.businessId,
    name,
    address,
    shopNumber: nextNumber,
    createdAtIso,
  })
  if (remote.error) return { shop: null, error: remote.error }

  await writeShopLocal({
    id,
    businessId: params.businessId,
    name,
    address,
    shopNumber: nextNumber,
    now,
  })

  const sourceShop =
    params.existing.find((shop) => shop.shopNumber === 1) ?? params.existing[0] ?? null
  if (sourceShop) {
    const cloned = await cloneShopCatalog({
      businessId: params.businessId,
      sourceShopId: sourceShop.id,
      targetShopId: id,
    })
    if (cloned.error) {
      console.warn('[shops] clone catalog failed:', cloned.error)
    }
  }

  return {
    shop: {
      id,
      businessId: params.businessId,
      name,
      address,
      shopNumber: nextNumber,
      createdAt: now,
      updatedAt: now,
    },
    error: null,
  }
}

export async function updateShopAddress(params: {
  shop: Shop
  address: string
}): Promise<{ error: string | null }> {
  const address = normalizeShopAddress(params.address)
  const addressErr = validateShopAddress(address)
  if (addressErr) return { error: addressErr }

  const now = Date.now()
  const { error } = await supabase
    .from('shops')
    .update({ address, updated_at: new Date(now).toISOString() })
    .eq('id', params.shop.id)
  if (error) return { error: error.message }

  if (database) {
    try {
      const record = await database.get<ShopModel>('shops').find(params.shop.id)
      await database.write(async () => {
        await record.update((row) => {
          row.address = address
          wmRaw(row).updated_at = now
        })
      })
    } catch {
      /* local row may be missing */
    }
  }

  return { error: null }
}

export async function getLastUsedShopId(businessId: string): Promise<string | null> {
  if (!businessId) return null
  try {
    return await SecureStore.getItemAsync(lastShopKey(businessId))
  } catch {
    return null
  }
}

export async function setLastUsedShopId(businessId: string, shopId: string): Promise<void> {
  if (!businessId || !shopId) return
  try {
    await SecureStore.setItemAsync(lastShopKey(businessId), shopId)
  } catch {
    /* ignore */
  }
}

export function resolveDefaultShopId(shops: Shop[], lastUsedId: string | null): string | null {
  if (shops.length === 0) return null
  if (lastUsedId && shops.some((shop) => shop.id === lastUsedId)) return lastUsedId
  return shops[0]?.id ?? null
}
