import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import { buildOutstandingMap } from '../lib/creditLedger'
import { mapCustomerRecord } from './useCustomers'
import { mapSaleRecord, mapSaleItemRecord } from './useSales'
import type { Customer, PaymentMethod, Product, Sale, SaleItem } from '../types'
import type CreditSaleModel from '../database/models/CreditSale'
import type CustomerModel from '../database/models/Customer'
import type ProductModel from '../database/models/Product'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CashBreakdownItem {
  method: PaymentMethod
  totalCents: number
  count: number
  creditCountKind?: 'customers' | 'sales'
}

export interface RecentSaleEntry {
  sale: Sale
  saleItems: SaleItem[]
}

export interface DashboardData {
  todaysSalesCents: number
  todaysProfitCents: number
  todaysTransactionCount: number
  todaysMarginPercent: number
  totalStockValueCents: number
  totalProductCount: number
  outstandingCreditCents: number
  creditCustomerCount: number
  cashBreakdown: CashBreakdownItem[]
  lowStockProducts: Product[]
  recentSales: RecentSaleEntry[]
  creditCustomers: Customer[]
  isLoading: boolean
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Local mapper helpers
// ---------------------------------------------------------------------------

function mapProductRecord(record: ProductModel): Product {
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    category: record.category ?? undefined,
    unit: record.unit,
    costPriceCents: record.costPriceCents,
    sellingPriceCents: record.sellingPriceCents,
    stockQty: record.stockQty,
    lowStockThreshold: record.lowStockThreshold,
    isActive: record.isActive,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.getTime() : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const EMPTY: Omit<DashboardData, 'isLoading' | 'refetch'> = {
  todaysSalesCents: 0,
  todaysProfitCents: 0,
  todaysTransactionCount: 0,
  todaysMarginPercent: 0,
  totalStockValueCents: 0,
  totalProductCount: 0,
  outstandingCreditCents: 0,
  creditCustomerCount: 0,
  cashBreakdown: [],
  lowStockProducts: [],
  recentSales: [],
  creditCustomers: [],
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useDashboard
 *
 * Reads all metrics from local WatermelonDB (offline-first). Supabase sync
 * runs separately in the background.
 *
 * Credit balance formula — IDENTICAL to useCustomers and useCustomerDetail:
 *   outstanding(customer) = Σ max(0, amountCents − amountPaidCents)
 *                            over the customer's credit_sales rows
 *
 * Reactive subscriptions fire on every WatermelonDB write so figures update
 * instantly.  A queued-refetch pattern (needsRefetchRef) ensures no update
 * is dropped when multiple subscriptions fire close together.
 */
export function useDashboard(businessId: string): DashboardData {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState<Omit<DashboardData, 'isLoading' | 'refetch'>>(EMPTY)
  const [refreshToken, setRefreshToken] = useState(0)

  const cancelledRef = useRef(false)
  const isFetchingRef = useRef(false)
  const needsRefetchRef = useRef(false)

  useEffect(() => {
    if (!database || !businessId) {
      setIsLoading(false)
      return
    }

    cancelledRef.current = false
    isFetchingRef.current = false
    needsRefetchRef.current = false

    // ── fetchData ──────────────────────────────────────────────────────────
    // Runs entirely against WatermelonDB — no network calls.
    // Queued-refetch: if one pass is already running we set needsRefetchRef
    // instead of starting a second. The in-flight pass restarts in finally().
    const fetchData = async () => {
      if (cancelledRef.current) return
      if (isFetchingRef.current) {
        needsRefetchRef.current = true
        return
      }

      isFetchingRef.current = true
      needsRefetchRef.current = false

      try {
        const now = new Date()
        const startOfToday = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        ).getTime()

        // ── Parallel DB reads ──────────────────────────────────────────────
        const [todaySalesRaw, allProductsRaw, allCustomersRaw, recentSalesRaw] =
          await Promise.all([
            database!
              .get<SaleModel>('sales')
              .query(
                Q.where('business_id', businessId),
                Q.where('created_at', Q.gte(startOfToday)),
              )
              .fetch(),
            database!
              .get<ProductModel>('products')
              .query(Q.where('business_id', businessId), Q.where('is_active', true))
              .fetch(),
            database!
              .get<CustomerModel>('customers')
              .query(Q.where('business_id', businessId))
              .fetch(),
            database!
              .get<SaleModel>('sales')
              .query(
                Q.where('business_id', businessId),
                Q.sortBy('created_at', Q.desc),
                Q.take(5),
              )
              .fetch(),
          ])

        if (cancelledRef.current) return

        // ── Credit rows — authoritative source for balances ────────────────
        const customerIds = allCustomersRaw.map((c) => c.id)
        const creditSalesRaw: CreditSaleModel[] =
          customerIds.length > 0
            ? await database!
                .get<CreditSaleModel>('credit_sales')
                .query(Q.where('customer_id', Q.oneOf(customerIds)))
                .fetch()
            : []

        if (cancelledRef.current) return

        // ── Sale items for today + recent ──────────────────────────────────
        const neededSaleIds = [
          ...new Set([...todaySalesRaw.map((s) => s.id), ...recentSalesRaw.map((s) => s.id)]),
        ]
        const allSaleItemsRaw: SaleItemModel[] =
          neededSaleIds.length > 0
            ? await database!
                .get<SaleItemModel>('sale_items')
                .query(Q.where('sale_id', Q.oneOf(neededSaleIds)))
                .fetch()
            : []

        if (cancelledRef.current) return

        // ── Today metrics ──────────────────────────────────────────────────
        const mappedTodaySales = todaySalesRaw.map(mapSaleRecord)
        const todaysSalesCents = mappedTodaySales.reduce((s, sale) => s + sale.totalCents, 0)
        const todaysTransactionCount = mappedTodaySales.length

        const itemsBySaleId = allSaleItemsRaw.reduce<Record<string, SaleItemModel[]>>(
          (acc, item) => {
            acc[item.saleId] = [...(acc[item.saleId] ?? []), item]
            return acc
          },
          {},
        )

        let todaysProfitCents = 0
        for (const saleRecord of todaySalesRaw) {
          for (const item of itemsBySaleId[saleRecord.id] ?? []) {
            todaysProfitCents += (item.unitPriceCents - item.costPriceCents) * item.qty
          }
        }
        const todaysMarginPercent =
          todaysSalesCents > 0
            ? parseFloat(((todaysProfitCents / todaysSalesCents) * 100).toFixed(1))
            : 0

        // ── Inventory metrics ──────────────────────────────────────────────
        const mappedProducts = allProductsRaw.map(mapProductRecord)
        const totalStockValueCents = mappedProducts.reduce(
          (s, p) => s + p.sellingPriceCents * p.stockQty,
          0,
        )
        const totalProductCount = mappedProducts.length
        const lowStockProducts = mappedProducts
          .filter((p) => p.stockQty <= p.lowStockThreshold)
          .sort((a, b) => a.stockQty - b.stockQty)

        // ── Credit metrics — same formula as useCustomers + useCustomerDetail ─
        const creditRows = creditSalesRaw.map((cs) => ({
          customerId: cs.customerId,
          amountCents: cs.amountCents,
          amountPaidCents: cs.amountPaidCents,
        }))

        const customerIdSet = new Set(customerIds)
        const outstandingMap = buildOutstandingMap(creditRows, customerIdSet)

        const allCustomersMapped: Customer[] = allCustomersRaw.map((r) => {
          const base = mapCustomerRecord(r)
          return {
            ...base,
            outstandingBalanceCents: outstandingMap.get(base.id) ?? 0,
          }
        })

        const creditCustomers = allCustomersMapped
          .filter((c) => c.outstandingBalanceCents > 0)
          .sort((a, b) => b.outstandingBalanceCents - a.outstandingBalanceCents)

        const outstandingCreditCents = creditCustomers.reduce(
          (s, c) => s + c.outstandingBalanceCents,
          0,
        )
        const creditCustomerCount = creditCustomers.length

        // ── Cash breakdown ─────────────────────────────────────────────────
        let todayCreditSaleCount = 0
        const cashMap = new Map<PaymentMethod, { totalCents: number; count: number }>()
        for (const sale of mappedTodaySales) {
          if (sale.paymentMethod === 'credit') {
            todayCreditSaleCount++
            continue
          }
          const existing = cashMap.get(sale.paymentMethod) ?? { totalCents: 0, count: 0 }
          cashMap.set(sale.paymentMethod, {
            totalCents: existing.totalCents + sale.totalCents,
            count: existing.count + 1,
          })
        }
        if (outstandingCreditCents > 0 || todayCreditSaleCount > 0) {
          cashMap.set('credit', {
            totalCents: outstandingCreditCents,
            count: outstandingCreditCents > 0 ? creditCustomerCount : todayCreditSaleCount,
          })
        }
        const cashBreakdown: CashBreakdownItem[] = Array.from(cashMap.entries()).map(
          ([method, { totalCents, count }]) => ({
            method,
            totalCents,
            count,
            ...(method === 'credit'
              ? {
                  creditCountKind:
                    outstandingCreditCents > 0
                      ? ('customers' as const)
                      : ('sales' as const),
                }
              : {}),
          }),
        )

        // ── Recent sales with items ────────────────────────────────────────
        const recentSales: RecentSaleEntry[] = recentSalesRaw.map((saleRecord) => ({
          sale: mapSaleRecord(saleRecord),
          saleItems: (itemsBySaleId[saleRecord.id] ?? []).map(mapSaleItemRecord),
        }))

        if (!cancelledRef.current) {
          setData({
            todaysSalesCents,
            todaysProfitCents,
            todaysTransactionCount,
            todaysMarginPercent,
            totalStockValueCents,
            totalProductCount,
            outstandingCreditCents,
            creditCustomerCount,
            cashBreakdown,
            lowStockProducts,
            recentSales,
            creditCustomers,
          })
          setIsLoading(false)
        }
      } catch (err) {
        console.error('[useDashboard] fetchData error:', err)
        if (!cancelledRef.current) setIsLoading(false)
      } finally {
        isFetchingRef.current = false
        if (needsRefetchRef.current && !cancelledRef.current) {
          needsRefetchRef.current = false
          fetchData()
        }
      }
    }

    fetchData()

    // ── Reactive subscriptions ─────────────────────────────────────────────
    // Each table subscription triggers fetchData via the queue so updates
    // appear instantly after every WatermelonDB write.

    const salesSub = database
      .get<SaleModel>('sales')
      .query(Q.where('business_id', businessId))
      .observe()
      .subscribe(() => fetchData())

    const productsSub = database
      .get<ProductModel>('products')
      .query(Q.where('business_id', businessId), Q.where('is_active', true))
      .observe()
      .subscribe(() => fetchData())

    const customersSub = database
      .get<CustomerModel>('customers')
      .query(Q.where('business_id', businessId))
      .observe()
      .subscribe(() => fetchData())

    // credit_sales fires immediately when a payment is recorded or a credit
    // sale is created — before the customer row cache is even updated.
    const creditSalesSub = database
      .get<CreditSaleModel>('credit_sales')
      .query()
      .observe()
      .subscribe(() => fetchData())

    return () => {
      cancelledRef.current = true
      salesSub.unsubscribe()
      productsSub.unsubscribe()
      customersSub.unsubscribe()
      creditSalesSub.unsubscribe()
    }
  }, [businessId, refreshToken])

  const refetch = useCallback(() => setRefreshToken((t) => t + 1), [])

  return { ...data, isLoading, refetch }
}
