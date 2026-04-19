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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISO(ms: number): string {
  return new Date(ms === 0 ? 0 : ms).toISOString()
}

/** Epoch ISO used to pull everything on first sync (lastSyncedAt = 0). */
function pullThreshold(lastSyncedAt: number): string {
  return lastSyncedAt === 0 ? '1970-01-01T00:00:00.000Z' : toISO(lastSyncedAt)
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
    // ---- PUSH ----
    const localRecords = await database
      .get<Product>('products')
      .query(
        Q.where('business_id', businessId),
        Q.or(
          Q.where('supabase_id', Q.eq(null)),
          Q.where('updated_at', Q.gt(lastSyncedAt)),
        ),
      )
      .fetch()

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
        created_at: toISO(r._raw.created_at as number),
        updated_at: toISO(r._raw.updated_at as number),
      }))

      const { error: pushError } = await supabase
        .from('products')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localRecords.length
        // Mark unsynced records as synced
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

    // ---- PULL ----
    const { data: remoteRecords, error: pullError } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .gt('updated_at', pullThreshold(lastSyncedAt))
      .order('updated_at', { ascending: true })

    if (!pullError && remoteRecords && remoteRecords.length > 0) {
      const ops: ReturnType<Product['prepareUpdate']>[] = []

      for (const remote of remoteRecords) {
        const remoteMs = new Date(remote.updated_at).getTime()

        try {
          const existing = await database.get<Product>('products').find(remote.id)
          const localMs = existing._raw.updated_at as number

          if (remoteMs > localMs) {
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
                r._raw.updated_at = remoteMs
              }),
            )
          }
        } catch {
          // Record not found locally — create it
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
              r._raw.created_at = new Date(remote.created_at).getTime()
              r._raw.updated_at = remoteMs
            }) as ReturnType<Product['prepareUpdate']>,
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
      error: `products: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  return { pushed, pulled }
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
    // ---- PUSH ----
    const localRecords = await database
      .get<Customer>('customers')
      .query(
        Q.where('business_id', businessId),
        Q.or(
          Q.where('supabase_id', Q.eq(null)),
          Q.where('updated_at', Q.gt(lastSyncedAt)),
        ),
      )
      .fetch()

    if (localRecords.length > 0) {
      const payload = localRecords.map((r) => ({
        id: r.id,
        business_id: r.businessId,
        name: r.name,
        phone: r.phone,
        outstanding_balance_cents: r.outstandingBalanceCents,
        created_at: toISO(r._raw.created_at as number),
        updated_at: toISO(r._raw.updated_at as number),
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

    // ---- PULL ----
    const { data: remoteRecords, error: pullError } = await supabase
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .gt('updated_at', pullThreshold(lastSyncedAt))
      .order('updated_at', { ascending: true })

    if (!pullError && remoteRecords && remoteRecords.length > 0) {
      const ops: ReturnType<Customer['prepareUpdate']>[] = []

      for (const remote of remoteRecords) {
        const remoteMs = remote.updated_at
          ? new Date(remote.updated_at).getTime()
          : new Date(remote.created_at).getTime()

        try {
          const existing = await database.get<Customer>('customers').find(remote.id)
          const localMs = (existing._raw.updated_at as number) || (existing._raw.created_at as number)

          if (remoteMs > localMs) {
            ops.push(
              existing.prepareUpdate((r) => {
                r.name = remote.name
                r.phone = remote.phone
                r.outstandingBalanceCents = remote.outstanding_balance_cents
                r.supabaseId = remote.id
                r._raw.updated_at = remoteMs
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
              r._raw.created_at = new Date(remote.created_at).getTime()
              r._raw.updated_at = remoteMs
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
        created_at: toISO(sale._raw.created_at as number),
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
    const { data: remoteSales, error: pullError } = await supabase
      .from('sales')
      .select('*')
      .eq('business_id', businessId)
      .gt('created_at', pullThreshold(lastSyncedAt))
      .order('created_at', { ascending: true })

    if (!pullError && remoteSales && remoteSales.length > 0) {
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
              s.supabaseId = remoteSale.id
              s._raw.created_at = new Date(remoteSale.created_at).getTime()
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
        created_at: toISO(m._raw.created_at as number),
      }))

      const { error: pushError } = await supabase
        .from('stock_movements')
        .upsert(payload, { onConflict: 'id' })

      if (!pushError) {
        pushed = localMovements.length
      }
    }

    // ---- PULL new remote movements ----
    const { data: remoteMovements, error: pullError } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      .gt('created_at', pullThreshold(lastSyncedAt))
      .order('created_at', { ascending: true })

    if (!pullError && remoteMovements && remoteMovements.length > 0) {
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
                m._raw.created_at = new Date(remote.created_at).getTime()
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
        created_at: toISO(cs._raw.created_at as number),
        updated_at: toISO(cs._raw.updated_at as number),
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
    const { data: remoteCreditSales, error: pullError } = await supabase
      .from('credit_sales')
      .select('*')
      .in('sale_id', businessSaleIds)
      .gt('updated_at', pullThreshold(lastSyncedAt))
      .order('updated_at', { ascending: true })

    if (!pullError && remoteCreditSales && remoteCreditSales.length > 0) {
      const ops: ReturnType<CreditSale['prepareUpdate']>[] = []

      for (const remote of remoteCreditSales) {
        const remoteMs = remote.updated_at
          ? new Date(remote.updated_at).getTime()
          : new Date(remote.created_at).getTime()

        try {
          const existing = await database.get<CreditSale>('credit_sales').find(remote.id)
          const localMs =
            (existing._raw.updated_at as number) ||
            (existing._raw.created_at as number)

          if (remoteMs > localMs) {
            ops.push(
              existing.prepareUpdate((cs) => {
                cs.amountPaidCents = remote.amount_paid_cents
                cs.isSettled = remote.is_settled
                cs.supabaseId = remote.id
                cs._raw.updated_at = remoteMs
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
              cs._raw.created_at = new Date(remote.created_at).getTime()
              cs._raw.updated_at = remoteMs
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
        created_at: toISO(r._raw.created_at as number),
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
    const { data: remoteRecords, error: pullError } = await supabase
      .from('payment_records')
      .select('*')
      .in('customer_id', customerIds)
      .gt('created_at', pullThreshold(lastSyncedAt))
      .order('created_at', { ascending: true })

    if (!pullError && remoteRecords && remoteRecords.length > 0) {
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
                r._raw.created_at = new Date(remote.created_at).getTime()
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

  const results = await Promise.allSettled([
    syncProducts(businessId, lastSyncedAt),
    syncCustomers(businessId, lastSyncedAt),
    syncSales(businessId, lastSyncedAt),
    syncStockMovements(businessId, lastSyncedAt),
    syncCreditSales(businessId, lastSyncedAt),
    syncPaymentRecords(businessId, lastSyncedAt),
  ])

  for (const result of results) {
    if (result.status === 'fulfilled') {
      totalPushed += result.value.pushed
      totalPulled += result.value.pulled
      if (result.value.error) {
        errors.push(result.value.error)
      }
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
    }
  }

  const now = Date.now()
  await setLastSyncedAt(businessId, now)

  // Status is 'error' only if ALL tables failed (errors === 6 means all failed)
  const allFailed = errors.length === 6
  const status: SyncStatus = allFailed ? 'error' : 'success'

  return {
    status,
    lastSyncedAt: now,
    recordsPushed: totalPushed,
    recordsPulled: totalPulled,
    errors,
  }
}

/**
 * Identical to syncAll — exported as a named alias for the manual
 * "Sync Now" button in the Settings screen.
 */
export async function manualSync(businessId: string): Promise<SyncResult> {
  return syncAll(businessId)
}
