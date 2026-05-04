import * as SecureStore from 'expo-secure-store'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import { supabase } from './supabase'
import type Product from '../database/models/Product'
import type Customer from '../database/models/Customer'
import type Sale from '../database/models/Sale'
import type SaleItem from '../database/models/SaleItem'
import type StockMovement from '../database/models/StockMovement'
import type CreditSale from '../database/models/CreditSale'
import type PaymentRecord from '../database/models/PaymentRecord'
import type ActivityLog from '../database/models/ActivityLog'
import { wmRaw } from './watermelonRaw'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export type SyncResult = {
  status: SyncStatus
  lastSyncedAt: number | null
  recordsPushed: number
  recordsPulled: number
  errors: string[]
}

type TableResult = {
  pushed: number
  pulled: number
  error?: string
}

/**
 * How far back incremental pulls reach (same idea as sales).
 * Staff `push_sale` commits the sale row before line items and stock decrements finish,
 * so owner Realtime can trigger sync while `products.updated_at` is still old. A strict
 * cursor alone can then skip the stock row after the cursor jumps forward (especially
 * with device/server clock skew). Re-fetching a rolling window keeps inventory aligned.
 */
const REMOTE_PULL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Timestamp storage
// ---------------------------------------------------------------------------

const SYNC_KEY_PREFIX = 'last_sync_'

async function getLastSyncedAt(businessId: string): Promise<number> {
  try {
    const stored = await SecureStore.getItemAsync(`${SYNC_KEY_PREFIX}${businessId}`)
    return stored ? parseInt(stored, 10) : 0
  } catch {
    return 0
  }
}

async function setLastSyncedAt(businessId: string, timestamp: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(`${SYNC_KEY_PREFIX}${businessId}`, timestamp.toString())
  } catch {
    // SecureStore failure must not crash sync
  }
}

/** Clears the stored sync cursor so the next sync does a full pull. */
export async function clearBusinessSyncCursor(businessId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${SYNC_KEY_PREFIX}${businessId}`)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISO(ms: number): string {
  return new Date(ms === 0 ? 0 : ms).toISOString()
}

/** Row shape from Supabase `products` (owner sync pull + shopkeeper edge pull). */
export type SupabaseProductRow = {
  id: string
  business_id: string
  name: string
  category: string | null
  unit: string
  cost_price_cents: number
  selling_price_cents: number
  stock_qty: number
  low_stock_threshold: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MergeRemoteProductsOptions = {
  /**
   * Apply every server row over local state (ignore updated_at ordering).
   * Use on login / session restore so dashboard stock matches Supabase even when
   * server timestamps lag or local clocks differ.
   */
  authoritative?: boolean
}

/**
 * Merge remote product rows into WatermelonDB (create/update by id).
 * Used by owner incremental sync and shopkeeper `pull_products`.
 */
export async function mergeRemoteProductsIntoWatermelon(
  remoteRecords: SupabaseProductRow[],
  options?: MergeRemoteProductsOptions,
): Promise<number> {
  if (!database || remoteRecords.length === 0) return 0

  const ops: ReturnType<Product['prepareUpdate']>[] = []
  const authoritative = options?.authoritative === true

  for (const remote of remoteRecords) {
    const remoteMs = new Date(remote.updated_at).getTime()

    try {
      const existing = await database.get<Product>('products').find(remote.id)
      const localMs = wmRaw(existing).updated_at as number

      // Use >= so a patch that echoes back the exact same timestamp we wrote
      // locally still wins and applies the authoritative server stock value.
      if (authoritative || remoteMs >= localMs) {
        ops.push(
          existing.prepareUpdate((r) => {
            r.name = remote.name
            r.category = remote.category
            r.unit = remote.unit
            r.costPriceCents = remote.cost_price_cents
            r.sellingPriceCents = remote.selling_price_cents
            r.stockQty = remote.stock_qty
            r.lowStockThreshold = remote.low_stock_threshold
            r.isActive = remote.is_active
            r.supabaseId = remote.id
            wmRaw(r).updated_at = remoteMs
          }),
        )
      }
    } catch {
      ops.push(
        database.get<Product>('products').prepareCreate((r) => {
          r._raw.id = remote.id
          r.businessId = remote.business_id
          r.name = remote.name
          r.category = remote.category
          r.unit = remote.unit
          r.costPriceCents = remote.cost_price_cents
          r.sellingPriceCents = remote.selling_price_cents
          r.stockQty = remote.stock_qty
          r.lowStockThreshold = remote.low_stock_threshold
          r.isActive = remote.is_active
          r.supabaseId = remote.id
          wmRaw(r).created_at = new Date(remote.created_at).getTime()
          wmRaw(r).updated_at = remoteMs
        }) as ReturnType<Product['prepareUpdate']>,
      )
    }
  }

  if (ops.length === 0) return 0

  await database.write(async () => {
    await database!.batch(...ops)
  })
  return ops.length
}

// ---------------------------------------------------------------------------
// Sales merge (owner sync pull + shopkeeper edge pull)
// ---------------------------------------------------------------------------

export type SupabaseSaleRow = {
  id: string
  business_id: string
  total_cents: number
  discount_cents: number
  payment_method: string
  receipt_number: string
  note: string | null
  created_at: string
  created_by_shopkeeper_id?: string | null
}

export type SupabaseSaleItemRow = {
  id: string
  sale_id: string
  product_id: string
  product_name_snapshot: string
  qty: number
  unit_price_cents: number
  cost_price_cents: number
}

/** Insert remote sales + items when missing locally (sales are immutable). */
export async function mergeRemoteSalesAndItemsIntoWatermelon(
  remoteSales: SupabaseSaleRow[],
  remoteItems: SupabaseSaleItemRow[],
): Promise<number> {
  if (!database || remoteSales.length === 0) return 0

  const itemsBySale = remoteItems.reduce<Record<string, SupabaseSaleItemRow[]>>((acc, row) => {
    const k = row.sale_id
    acc[k] = [...(acc[k] ?? []), row]
    return acc
  }, {})

  let merged = 0

  for (const remoteSale of remoteSales) {
    try {
      await database.get<Sale>('sales').find(remoteSale.id)
      // exists — skip
    } catch {
      const bundleItems = itemsBySale[remoteSale.id] ?? []

      await database.write(async () => {
        const saleOp = database!.get<Sale>('sales').prepareCreate((s) => {
          s._raw.id = remoteSale.id
          s.businessId = remoteSale.business_id
          s.totalCents = remoteSale.total_cents
          s.discountCents = remoteSale.discount_cents
          s.paymentMethod = remoteSale.payment_method
          s.receiptNumber = remoteSale.receipt_number
          s.note = remoteSale.note
          s.createdByShopkeeperId = remoteSale.created_by_shopkeeper_id ?? null
          s.supabaseId = remoteSale.id
          wmRaw(s).created_at = new Date(remoteSale.created_at).getTime()
        })

        const itemOps = bundleItems.map((remoteItem) =>
          database!.get<SaleItem>('sale_items').prepareCreate((item) => {
            item._raw.id = remoteItem.id
            item.saleId = remoteItem.sale_id
            item.productId = remoteItem.product_id
            item.productNameSnapshot = remoteItem.product_name_snapshot
            item.qty = remoteItem.qty
            item.unitPriceCents = remoteItem.unit_price_cents
            item.costPriceCents = remoteItem.cost_price_cents
          }),
        )

        await database!.batch(saleOp, ...itemOps)
      })

      merged++
    }
  }

  return merged
}

/** Epoch ISO used for incremental pulls (lastSyncedAt > 0). */
function pullThreshold(lastSyncedAt: number): string {
  return lastSyncedAt === 0 ? '1970-01-01T00:00:00.000Z' : toISO(lastSyncedAt)
}

/**
 * First sync (lastSyncedAt === 0) must not filter by timestamp — rows with NULL
 * `updated_at` / edge timestamps would be skipped; PostgREST `gt` excludes NULLs.
 */
function withPullTimeFilter<
  T extends {
    gt: (column: string, value: string) => T
  },
>(query: T, column: 'updated_at' | 'created_at', lastSyncedAt: number): T {
  if (lastSyncedAt === 0) return query
  return query.gt(column, pullThreshold(lastSyncedAt))
}

// ---------------------------------------------------------------------------
// Products sync
// ---------------------------------------------------------------------------

async function syncProducts(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // ---- PULL FIRST (LWW: know what the server has before deciding what to push) ----
    // Remote wins when its updated_at >= local (authoritative stock from server).
    // We pull first so the push step can skip records where the server is already
    // as-new-or-newer, preventing an older local write from overwriting a newer one.
    const productsPullLowerBound =
      lastSyncedAt > 0 ? Math.max(0, lastSyncedAt - REMOTE_PULL_LOOKBACK_MS) : 0
    const productsPull = withPullTimeFilter(
      supabase.from('products').select('*').eq('business_id', businessId),
      'updated_at',
      productsPullLowerBound,
    )
    const { data: remoteRecords, error: pullError } = await productsPull.order(
      'updated_at',
      { ascending: true },
    )

    if (pullError) {
      return { pushed, pulled, error: `products pull: ${pullError.message}` }
    }

    // Build a map of the remote timestamp by product id so the push can filter.
    const remoteUpdatedAt = new Map<string, number>()
    if (remoteRecords) {
      for (const r of remoteRecords) {
        remoteUpdatedAt.set(r.id, new Date(r.updated_at).getTime())
      }
      if (remoteRecords.length > 0) {
        pulled = await mergeRemoteProductsIntoWatermelon(remoteRecords as SupabaseProductRow[])
      }
    }

    // ---- PUSH: only records where local is still newer than remote ----
    // After the pull above, any record where remote was newer has already been
    // updated locally, so its WatermelonDB updated_at now reflects the server value
    // and it won't appear in this query. Records that are genuinely local-newer
    // (edited on this device since lastSyncedAt and more recently than remote) are
    // the ones that should win on the server.
    const candidates = await database
      .get<Product>('products')
      .query(
        Q.where('business_id', businessId),
        Q.or(
          Q.where('supabase_id', Q.eq(null)),
          Q.where('updated_at', Q.gt(lastSyncedAt)),
        ),
      )
      .fetch()

    const localRecords = candidates.filter((r) => {
      const localMs = wmRaw(r).updated_at as number
      const serverMs = remoteUpdatedAt.get(r.id)
      // New local record (not on server yet): always push.
      // Existing record: only push if local is strictly newer.
      return serverMs == null || localMs > serverMs
    })

    if (localRecords.length > 0) {
      const payload = localRecords.map((r) => ({
        id: r.id,
        business_id: r.businessId,
        name: r.name,
        category: r.category,
        unit: r.unit,
        cost_price_cents: r.costPriceCents,
        selling_price_cents: r.sellingPriceCents,
        stock_qty: r.stockQty,
        low_stock_threshold: r.lowStockThreshold,
        is_active: r.isActive,
        created_at: toISO(wmRaw(r).created_at as number),
        updated_at: toISO(wmRaw(r).updated_at as number),
      }))

      const { error: pushError } = await supabase
        .from('products')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localRecords.length
        const unsyncedRecords = localRecords.filter((r) => !r.supabaseId)
        if (unsyncedRecords.length > 0) {
          await database.write(async () => {
            await database!.batch(
              ...unsyncedRecords.map((r) =>
                r.prepareUpdate((rec) => {
                  rec.supabaseId = r.id
                }),
              ),
            )
          })
        }
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `products: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

/** Full product pull for the signed-in owner — aligns local stock with Supabase after login. */
export async function refreshOwnerProductsFromSupabase(businessId: string): Promise<void> {
  if (!database || !businessId) return

  const { data: remoteRecords, error } = await supabase
    .from('products')
    .select('*')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: true })

  if (error) {
    if (__DEV__) console.warn('[sync] refreshOwnerProductsFromSupabase:', error.message)
    return
  }
  if (!remoteRecords || remoteRecords.length === 0) return

  await mergeRemoteProductsIntoWatermelon(remoteRecords as SupabaseProductRow[], {
    authoritative: true,
  })
}

/**
 * Re-fetch only products that appear on a remote sale — used after staff sales so stock
 * matches `sale_items` without waiting for another incremental products pull.
 * Retries while `sale_items` appear (sale row can replicate before lines), then retries
 * product reads so stock decrements from `push_sale` are visible (same race as Realtime:
 * `sales` often fires before `products.stock_qty` updates).
 */
export async function refreshOwnerProductsForRemoteSale(
  businessId: string,
  saleId: string,
): Promise<void> {
  if (!database || !businessId || !saleId) return

  const itemRetries = 8
  const delayMs = 120

  let itemRows: { product_id: string }[] = []

  for (let attempt = 0; attempt < itemRetries; attempt++) {
    const { data: items, error: itemsErr } = await supabase
      .from('sale_items')
      .select('product_id')
      .eq('sale_id', saleId)

    if (itemsErr) {
      if (__DEV__) console.warn('[sync] refreshOwnerProductsForRemoteSale items:', itemsErr.message)
      return
    }
    if (items != null && items.length > 0) {
      itemRows = items
      break
    }
    if (attempt < itemRetries - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  if (itemRows.length === 0) return

  const productIds = [...new Set(itemRows.map((r) => String(r.product_id)).filter(Boolean))]
  if (productIds.length === 0) return

  for (let attempt = 0; attempt < itemRetries; attempt++) {
    const { data: rows, error } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .in('id', productIds)

    if (error) {
      if (__DEV__) console.warn('[sync] refreshOwnerProductsForRemoteSale products:', error.message)
      return
    }
    if (rows != null && rows.length > 0) {
      await mergeRemoteProductsIntoWatermelon(rows as SupabaseProductRow[], { authoritative: true })
    }
    if (attempt < itemRetries - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

// ---------------------------------------------------------------------------
// Customers sync
// ---------------------------------------------------------------------------

async function syncCustomers(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // ---- PULL FIRST (LWW — same pattern as syncProducts) ----
    const customersPull = withPullTimeFilter(
      supabase.from('customers').select('*').eq('business_id', businessId),
      'updated_at',
      lastSyncedAt,
    )
    const { data: remoteRecords, error: pullError } = await customersPull.order(
      'updated_at',
      { ascending: true },
    )

    if (pullError) {
      return { pushed, pulled, error: `customers pull: ${pullError.message}` }
    }

    const remoteUpdatedAt = new Map<string, number>()
    if (remoteRecords) {
      for (const remote of remoteRecords) {
        const remoteMs = remote.updated_at
          ? new Date(remote.updated_at).getTime()
          : new Date(remote.created_at).getTime()
        remoteUpdatedAt.set(remote.id, remoteMs)
      }

      if (remoteRecords.length > 0) {
        const ops: ReturnType<Customer['prepareUpdate']>[] = []
        for (const remote of remoteRecords) {
          const remoteMs = remoteUpdatedAt.get(remote.id)!
          try {
            const existing = await database.get<Customer>('customers').find(remote.id)
            const localMs =
              (wmRaw(existing).updated_at as number) || (wmRaw(existing).created_at as number)
            if (remoteMs > localMs) {
              ops.push(
                existing.prepareUpdate((r) => {
                  r.name = remote.name
                  r.phone = remote.phone
                  r.outstandingBalanceCents = remote.outstanding_balance_cents
                  r.supabaseId = remote.id
                  wmRaw(r).updated_at = remoteMs
                }),
              )
            }
          } catch {
            ops.push(
              database.get<Customer>('customers').prepareCreate((r) => {
                r._raw.id = remote.id
                r.businessId = remote.business_id
                r.name = remote.name
                r.phone = remote.phone
                r.outstandingBalanceCents = remote.outstanding_balance_cents
                r.supabaseId = remote.id
                wmRaw(r).created_at = new Date(remote.created_at).getTime()
                wmRaw(r).updated_at = remoteMs
              }) as ReturnType<Customer['prepareUpdate']>,
            )
          }
        }
        if (ops.length > 0) {
          await database.write(async () => {
            await database!.batch(...ops)
          })
          pulled = ops.length
        }
      }
    }

    // ---- PUSH: only records locally newer than what server has ----
    const candidates = await database
      .get<Customer>('customers')
      .query(
        Q.where('business_id', businessId),
        Q.or(
          Q.where('supabase_id', Q.eq(null)),
          Q.where('updated_at', Q.gt(lastSyncedAt)),
        ),
      )
      .fetch()

    const localRecords = candidates.filter((r) => {
      const localMs = (wmRaw(r).updated_at as number) || (wmRaw(r).created_at as number)
      const serverMs = remoteUpdatedAt.get(r.id)
      return serverMs == null || localMs > serverMs
    })

    if (localRecords.length > 0) {
      const payload = localRecords.map((r) => ({
        id: r.id,
        business_id: r.businessId,
        name: r.name,
        phone: r.phone,
        outstanding_balance_cents: r.outstandingBalanceCents,
        created_at: toISO(wmRaw(r).created_at as number),
        updated_at: toISO(wmRaw(r).updated_at as number),
      }))

      const { error: pushError } = await supabase
        .from('customers')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localRecords.length
        const unsyncedRecords = localRecords.filter((r) => !r.supabaseId)
        if (unsyncedRecords.length > 0) {
          await database.write(async () => {
            await database!.batch(
              ...unsyncedRecords.map((r) =>
                r.prepareUpdate((rec) => {
                  rec.supabaseId = r.id
                }),
              ),
            )
          })
        }
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `customers: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Sales + SaleItems sync (sales are immutable after creation)
// ---------------------------------------------------------------------------

async function syncSales(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // ---- PUSH new sales ----
    const localSales = await database
      .get<Sale>('sales')
      .query(
        Q.where('business_id', businessId),
        Q.where('supabase_id', Q.eq(null)),
      )
      .fetch()

    for (const sale of localSales) {
      const items = await sale.items.fetch()

      const salePayload = {
        id: sale.id,
        business_id: sale.businessId,
        total_cents: sale.totalCents,
        discount_cents: sale.discountCents,
        payment_method: sale.paymentMethod,
        receipt_number: sale.receiptNumber,
        note: sale.note,
        created_at: toISO(wmRaw(sale).created_at as number),
        created_by_shopkeeper_id: sale.createdByShopkeeperId ?? null,
      }

      const { error: saleError } = await supabase
        .from('sales')
        .upsert([salePayload], { onConflict: 'id' })

      if (saleError) continue

      // Push sale items alongside the sale
      if (items.length > 0) {
        const itemsPayload = items.map((item) => ({
          id: item.id,
          sale_id: item.saleId,
          product_id: item.productId,
          product_name_snapshot: item.productNameSnapshot,
          qty: item.qty,
          unit_price_cents: item.unitPriceCents,
          cost_price_cents: item.costPriceCents,
        }))

        await supabase
          .from('sale_items')
          .upsert(itemsPayload, { onConflict: 'id' })
      }

      // Mark sale as synced
      await database.write(async () => {
        await sale.update((s) => {
          s.supabaseId = sale.id
        })
      })

      pushed++
    }

    // ---- PULL new remote sales ----
    // Rolling lookback (same window as products): offline shopkeeper sales and clock skew.
    const salesLookbackAt =
      lastSyncedAt > 0 ? Math.max(0, lastSyncedAt - REMOTE_PULL_LOOKBACK_MS) : 0
    const salesPull = withPullTimeFilter(
      supabase.from('sales').select('*').eq('business_id', businessId),
      'created_at',
      salesLookbackAt,
    )
    const { data: remoteSales, error: pullError } = await salesPull.order('created_at', {
      ascending: true,
    })

    if (pullError) {
      return {
        pushed,
        pulled,
        error: `sales pull: ${pullError.message}`,
      }
    }

    if (remoteSales && remoteSales.length > 0) {
      for (const remoteSale of remoteSales) {
        try {
          await database.get<Sale>('sales').find(remoteSale.id)
          // Already exists locally — sales are immutable, skip
        } catch {
          // Fetch this sale's items from Supabase
          const { data: remoteItems } = await supabase
            .from('sale_items')
            .select('*')
            .eq('sale_id', remoteSale.id)

          await database.write(async () => {
            const saleOp = database!.get<Sale>('sales').prepareCreate((s) => {
              s._raw.id = remoteSale.id
              s.businessId = remoteSale.business_id
              s.totalCents = remoteSale.total_cents
              s.discountCents = remoteSale.discount_cents
              s.paymentMethod = remoteSale.payment_method
              s.receiptNumber = remoteSale.receipt_number
              s.note = remoteSale.note
              s.createdByShopkeeperId = remoteSale.created_by_shopkeeper_id ?? null
              s.supabaseId = remoteSale.id
              wmRaw(s).created_at = new Date(remoteSale.created_at).getTime()
            })

            const itemOps = (remoteItems || []).map((remoteItem) =>
              database!.get<SaleItem>('sale_items').prepareCreate((item) => {
                item._raw.id = remoteItem.id
                item.saleId = remoteItem.sale_id
                item.productId = remoteItem.product_id
                item.productNameSnapshot = remoteItem.product_name_snapshot
                item.qty = remoteItem.qty
                item.unitPriceCents = remoteItem.unit_price_cents
                item.costPriceCents = remoteItem.cost_price_cents
              }),
            )

            await database!.batch(saleOp, ...itemOps)
          })

          pulled++
        }
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `sales: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Stock Movements sync (immutable, no supabase_id column)
// ---------------------------------------------------------------------------

async function syncStockMovements(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // ---- PUSH: movements created since last sync ----
    const localMovements = await database
      .get<StockMovement>('stock_movements')
      .query(
        Q.where('business_id', businessId),
        Q.where('created_at', Q.gt(lastSyncedAt)),
      )
      .fetch()

    if (localMovements.length > 0) {
      const payload = localMovements.map((m) => ({
        id: m.id,
        business_id: m.businessId,
        product_id: m.productId,
        product_name_snapshot: m.productNameSnapshot,
        action: m.action,
        qty_change: m.qtyChange,
        reason: m.reason,
        supplier: m.supplier,
        created_at: toISO(wmRaw(m).created_at as number),
      }))

      const { error: pushError } = await supabase
        .from('stock_movements')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localMovements.length
      }
    }

    // ---- PULL new remote movements ----
    // Rolling lookback so offline / clock-skew rows are not skipped (same idea as sales pull).
    const MOVEMENTS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
    const movementsLookbackAt = lastSyncedAt > 0 ? lastSyncedAt - MOVEMENTS_LOOKBACK_MS : 0
    const movementsPull = withPullTimeFilter(
      supabase.from('stock_movements').select('*').eq('business_id', businessId),
      'created_at',
      movementsLookbackAt,
    )
    const { data: remoteMovements, error: pullError } = await movementsPull.order(
      'created_at',
      { ascending: true },
    )

    if (pullError) {
      return {
        pushed,
        pulled,
        error: `stock_movements pull: ${pullError.message}`,
      }
    }

    if (remoteMovements && remoteMovements.length > 0) {
      const ops: ReturnType<StockMovement['prepareUpdate']>[] = []

      for (const remote of remoteMovements) {
        try {
          await database.get<StockMovement>('stock_movements').find(remote.id)
          // Already exists — immutable, skip
        } catch {
          ops.push(
            database
              .get<StockMovement>('stock_movements')
              .prepareCreate((m) => {
                m._raw.id = remote.id
                m.businessId = remote.business_id
                m.productId = remote.product_id
                m.productNameSnapshot = remote.product_name_snapshot
                m.action = remote.action
                m.qtyChange = remote.qty_change
                m.reason = remote.reason
                m.supplier = remote.supplier
                wmRaw(m).created_at = new Date(remote.created_at).getTime()
              }) as ReturnType<StockMovement['prepareUpdate']>,
          )
        }
      }

      if (ops.length > 0) {
        await database.write(async () => {
          await database!.batch(...ops)
        })
        pulled = ops.length
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `stock_movements: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Credit Sales sync
// ---------------------------------------------------------------------------

async function syncCreditSales(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // Resolve business credit sales by joining through sales
    // We query all local credit_sales whose sale references this business
    const businessSales = await database
      .get<Sale>('sales')
      .query(Q.where('business_id', businessId))
      .fetch()

    const businessSaleIds = businessSales.map((s) => s.id)

    if (businessSaleIds.length === 0) {
      return { pushed: 0, pulled: 0 }
    }

    // ---- PUSH ----
    const localCreditSales = await database
      .get<CreditSale>('credit_sales')
      .query(
        Q.where('sale_id', Q.oneOf(businessSaleIds)),
        Q.or(
          Q.where('supabase_id', Q.eq(null)),
          Q.where('updated_at', Q.gt(lastSyncedAt)),
        ),
      )
      .fetch()

    if (localCreditSales.length > 0) {
      const payload = localCreditSales.map((cs) => ({
        id: cs.id,
        sale_id: cs.saleId,
        customer_id: cs.customerId,
        amount_cents: cs.amountCents,
        amount_paid_cents: cs.amountPaidCents,
        is_settled: cs.isSettled,
        created_at: toISO(wmRaw(cs).created_at as number),
        updated_at: toISO(wmRaw(cs).updated_at as number),
      }))

      const { error: pushError } = await supabase
        .from('credit_sales')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localCreditSales.length
        const unsyncedRecords = localCreditSales.filter((cs) => !cs.supabaseId)
        if (unsyncedRecords.length > 0) {
          await database.write(async () => {
            await database!.batch(
              ...unsyncedRecords.map((cs) =>
                cs.prepareUpdate((rec) => {
                  rec.supabaseId = cs.id
                }),
              ),
            )
          })
        }
      }
    }

    // ---- PULL ----
    // Pull by sale_ids that belong to this business (credit_sales have no business_id)
    const creditPull = withPullTimeFilter(
      supabase.from('credit_sales').select('*').in('sale_id', businessSaleIds),
      'updated_at',
      lastSyncedAt,
    )
    const { data: remoteCreditSales, error: pullError } = await creditPull.order(
      'updated_at',
      { ascending: true },
    )

    if (pullError) {
      return {
        pushed,
        pulled,
        error: `credit_sales pull: ${pullError.message}`,
      }
    }

    if (remoteCreditSales && remoteCreditSales.length > 0) {
      const ops: ReturnType<CreditSale['prepareUpdate']>[] = []

      for (const remote of remoteCreditSales) {
        const remoteMs = remote.updated_at
          ? new Date(remote.updated_at).getTime()
          : new Date(remote.created_at).getTime()

        try {
          const existing = await database.get<CreditSale>('credit_sales').find(remote.id)
          const localMs =
            (wmRaw(existing).updated_at as number) ||
            (wmRaw(existing).created_at as number)

          if (remoteMs > localMs) {
            ops.push(
              existing.prepareUpdate((cs) => {
                cs.amountPaidCents = remote.amount_paid_cents
                cs.isSettled = remote.is_settled
                cs.supabaseId = remote.id
                wmRaw(cs).updated_at = remoteMs
              }),
            )
          }
        } catch {
          ops.push(
            database.get<CreditSale>('credit_sales').prepareCreate((cs) => {
              cs._raw.id = remote.id
              cs.saleId = remote.sale_id
              cs.customerId = remote.customer_id
              cs.amountCents = remote.amount_cents
              cs.amountPaidCents = remote.amount_paid_cents
              cs.isSettled = remote.is_settled
              cs.supabaseId = remote.id
              wmRaw(cs).created_at = new Date(remote.created_at).getTime()
              wmRaw(cs).updated_at = remoteMs
            }) as ReturnType<CreditSale['prepareUpdate']>,
          )
        }
      }

      if (ops.length > 0) {
        await database.write(async () => {
          await database!.batch(...ops)
        })
        pulled = ops.length
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `credit_sales: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Payment Records sync (immutable — created once, never mutated)
// Scoped via customer_id → business_id, same join pattern as credit_sales.
// ---------------------------------------------------------------------------

async function syncPaymentRecords(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }

  let pushed = 0
  let pulled = 0

  try {
    // Resolve which customer IDs belong to this business
    const businessCustomers = await database
      .get<import('../database/models/Customer').default>('customers')
      .query(Q.where('business_id', businessId))
      .fetch()

    const customerIds = businessCustomers.map((c) => c.id)

    if (customerIds.length === 0) {
      return { pushed: 0, pulled: 0 }
    }

    // ---- PUSH ----
    // Payment records are immutable so we only need to push records that
    // haven't been synced yet (supabase_id is null).
    const localRecords = await database
      .get<PaymentRecord>('payment_records')
      .query(
        Q.where('customer_id', Q.oneOf(customerIds)),
        Q.where('supabase_id', Q.eq(null)),
      )
      .fetch()

    if (localRecords.length > 0) {
      const payload = localRecords.map((r) => ({
        id: r.id,
        customer_id: r.customerId,
        amount_cents: r.amountCents,
        payment_method: r.paymentMethod,
        notes: r.notes,
        created_at: toISO(wmRaw(r).created_at as number),
      }))

      const { error: pushError } = await supabase
        .from('payment_records')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localRecords.length
        await database.write(async () => {
          await database!.batch(
            ...localRecords.map((r) =>
              r.prepareUpdate((rec) => {
                rec.supabaseId = r.id
              }),
            ),
          )
        })
      }
    }

    // ---- PULL ----
    // Pull any payment records created on another device since last sync.
    const paymentsPull = withPullTimeFilter(
      supabase.from('payment_records').select('*').in('customer_id', customerIds),
      'created_at',
      lastSyncedAt,
    )
    const { data: remoteRecords, error: pullError } = await paymentsPull.order('created_at', {
      ascending: true,
    })

    if (pullError) {
      return {
        pushed,
        pulled,
        error: `payment_records pull: ${pullError.message}`,
      }
    }

    if (remoteRecords && remoteRecords.length > 0) {
      const ops: ReturnType<PaymentRecord['prepareUpdate']>[] = []

      for (const remote of remoteRecords) {
        try {
          await database.get<PaymentRecord>('payment_records').find(remote.id)
          // Already exists locally — immutable, nothing to update
        } catch {
          ops.push(
            database
              .get<PaymentRecord>('payment_records')
              .prepareCreate((r) => {
                r._raw.id = remote.id
                r.customerId = remote.customer_id
                r.amountCents = remote.amount_cents
                r.paymentMethod = remote.payment_method
                r.notes = remote.notes ?? null
                r.supabaseId = remote.id
                wmRaw(r).created_at = new Date(remote.created_at).getTime()
              }) as ReturnType<PaymentRecord['prepareUpdate']>,
          )
        }
      }

      if (ops.length > 0) {
        await database.write(async () => {
          await database!.batch(...ops)
        })
        pulled = ops.length
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `payment_records: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Activity Logs sync (immutable)
// ---------------------------------------------------------------------------

async function syncActivityLogs(
  businessId: string,
  lastSyncedAt: number,
): Promise<TableResult> {
  if (!database) return { pushed: 0, pulled: 0 }
  let pushed = 0
  let pulled = 0

  try {
    const localRecords = await database
      .get<ActivityLog>('activity_logs')
      .query(Q.where('business_id', businessId), Q.where('created_at', Q.gt(lastSyncedAt)))
      .fetch()

    if (localRecords.length > 0) {
      const payload = localRecords.map((r) => ({
        id: r.id,
        business_id: r.businessId,
        actor_id: r.actorId,
        actor_name: r.actorName,
        actor_role: r.actorRole,
        action: r.action,
        entity_type: r.entityType,
        entity_id: r.entityId || null,
        entity_name: r.entityName || null,
        details: r.details ? JSON.parse(r.details) : null,
        created_at: toISO(wmRaw(r).created_at as number),
      }))

      const { error } = await supabase.from('activity_logs').upsert(payload, { onConflict: 'id' })
      if (!error) pushed = localRecords.length
    }

    const logsPull = withPullTimeFilter(
      supabase.from('activity_logs').select('*').eq('business_id', businessId),
      'created_at',
      lastSyncedAt,
    )
    const { data: remoteRecords, error: pullError } = await logsPull.order('created_at', {
      ascending: true,
    })
    if (pullError) return { pushed, pulled, error: `activity_logs pull: ${pullError.message}` }

    if (remoteRecords && remoteRecords.length > 0) {
      const ops: ReturnType<ActivityLog['prepareUpdate']>[] = []
      for (const remote of remoteRecords) {
        try {
          await database.get<ActivityLog>('activity_logs').find(remote.id)
        } catch {
          ops.push(
            database.get<ActivityLog>('activity_logs').prepareCreate((r) => {
              r._raw.id = remote.id
              r.businessId = remote.business_id
              r.actorId = remote.actor_id
              r.actorName = remote.actor_name
              r.actorRole = remote.actor_role
              r.action = remote.action
              r.entityType = remote.entity_type
              r.entityId = remote.entity_id ?? ''
              r.entityName = remote.entity_name ?? ''
              r.details = remote.details ? JSON.stringify(remote.details) : ''
              wmRaw(r).created_at = new Date(remote.created_at).getTime()
            }) as ReturnType<ActivityLog['prepareUpdate']>,
          )
        }
      }
      if (ops.length > 0) {
        await database.write(async () => {
          await database!.batch(...ops)
        })
        pulled = ops.length
      }
    }
  } catch (e) {
    return {
      pushed,
      pulled,
      error: `activity_logs: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
}

// ---------------------------------------------------------------------------
// Main sync orchestrator
// ---------------------------------------------------------------------------

export async function syncAll(businessId: string): Promise<SyncResult> {
  if (!database) {
    return {
      status: 'error',
      lastSyncedAt: null,
      recordsPushed: 0,
      recordsPulled: 0,
      errors: ['Local database not available'],
    }
  }

  const lastSyncedAt = await getLastSyncedAt(businessId)
  const errors: string[] = []
  let totalPushed = 0
  let totalPulled = 0

  // Phase 1: mutually independent tables — run in parallel for speed.
  // Each uses pull-first LWW (products, customers) or create-only append (sales, movements, logs).
  const phase1 = await Promise.allSettled([
    syncProducts(businessId, lastSyncedAt),
    syncCustomers(businessId, lastSyncedAt),
    syncSales(businessId, lastSyncedAt),
    syncStockMovements(businessId, lastSyncedAt),
    syncActivityLogs(businessId, lastSyncedAt),
  ])

  for (const r of phase1) {
    if (r.status === 'fulfilled') {
      totalPushed += r.value.pushed
      totalPulled += r.value.pulled
      if (r.value.error) errors.push(r.value.error)
    } else {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    }
  }

  // Phase 2: tables that join through phase-1 data already in local DB.
  // credit_sales needs local sales; payment_records needs local customers.
  const phase2 = await Promise.allSettled([
    syncCreditSales(businessId, lastSyncedAt),
    syncPaymentRecords(businessId, lastSyncedAt),
  ])

  for (const r of phase2) {
    if (r.status === 'fulfilled') {
      totalPushed += r.value.pushed
      totalPulled += r.value.pulled
      if (r.value.error) errors.push(r.value.error)
    } else {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    }
  }

  const now = Date.now()
  // Do not advance the sync cursor while critical pushes/pulls failed — otherwise
  // offline-first writes with updated_at > lastSyncedAt would never retry.
  const blockingErrors = errors.filter((e) => !e.startsWith('activity_logs'))
  let nextLastSyncedAt: number | null = null
  if (blockingErrors.length === 0) {
    await setLastSyncedAt(businessId, now)
    nextLastSyncedAt = now
  }

  // Status is 'error' only if every step failed.
  const totalSteps = phase1.length + phase2.length
  const allFailed = errors.length >= totalSteps
  const status: SyncStatus = allFailed ? 'error' : 'success'

  return {
    status,
    lastSyncedAt: nextLastSyncedAt,
    recordsPushed: totalPushed,
    recordsPulled: totalPulled,
    errors,
  }
}

/**
 * Fast-path inventory sync: push pending products + stock_movements to Supabase
 * and pull the latest back — both in parallel. Does NOT advance the global sync cursor
 * (syncAll handles that). Call this immediately after an owner inventory write so the
 * cloud is updated quickly and Realtime fires to shopkeeper devices; the full background
 * sync runs independently via triggerSync / useAutoSync.
 */
export async function syncInventoryFast(businessId: string): Promise<void> {
  if (!database) return
  const lastSyncedAt = await getLastSyncedAt(businessId)
  await Promise.all([
    syncProducts(businessId, lastSyncedAt).catch(() => {}),
    syncStockMovements(businessId, lastSyncedAt).catch(() => {}),
  ])
}

/**
 * Identical to syncAll — exported as a named alias for the manual
 * "Sync Now" button in the Settings screen.
 */
export async function manualSync(businessId: string): Promise<SyncResult> {
  return syncAll(businessId)
}
