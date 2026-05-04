import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { Q } from '@nozbe/watermelondb'
import type { Query } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Sale, SaleItem } from '../types'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'
import { calendarMonthKey, getLocalCalendarMonthBoundsMs } from '../lib/calendarMonth'

export interface SaleWithItems {
  sale: Sale
  saleItems: SaleItem[]
}

export function mapSaleRecord(record: SaleModel): Sale {
  return {
    id: record.id,
    businessId: record.businessId,
    totalCents: record.totalCents,
    discountCents: record.discountCents,
    paymentMethod: record.paymentMethod as Sale['paymentMethod'],
    note: record.note ?? undefined,
    receiptNumber: record.receiptNumber,
    createdByShopkeeperId: record.createdByShopkeeperId ?? undefined,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

export function mapSaleItemRecord(record: SaleItemModel): SaleItem {
  return {
    id: record.id,
    saleId: record.saleId,
    productId: record.productId,
    productNameSnapshot: record.productNameSnapshot,
    qty: record.qty,
    unitPriceCents: record.unitPriceCents,
    costPriceCents: record.costPriceCents,
  }
}

export function useSales(businessId: string) {
  const [sales, setSales] = useState<Sale[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [totalSalesCount, setTotalSalesCount] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const prevBusinessIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!businessId || !database) {
      setSales([])
      setIsLoading(false)
      prevBusinessIdRef.current = undefined
      return
    }

    const businessChanged = prevBusinessIdRef.current !== businessId
    prevBusinessIdRef.current = businessId
    if (businessChanged) setIsLoading(true)

    const subscription = database
      .get<SaleModel>('sales')
      .query(
        Q.where('business_id', businessId),
        Q.sortBy('created_at', Q.desc),
      )
      .observe()
      .subscribe({
        next: (records) => {
          setSales(records.map(mapSaleRecord))
          setTotalSalesCount(records.length)
          setIsLoading(false)
        },
        error: () => {
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId, refreshTick])

  const refetch = useCallback(() => setRefreshTick((t) => t + 1), [])

  return { sales, isLoading, totalSalesCount, refetch }
}

function useCalendarMonthKey(): string {
  const [key, setKey] = useState(() => calendarMonthKey())
  useEffect(() => {
    const bump = () => {
      const k = calendarMonthKey()
      setKey((p) => (p !== k ? k : p))
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') bump()
    })
    const id = setInterval(bump, 60_000)
    return () => {
      sub.remove()
      clearInterval(id)
    }
  }, [])
  return key
}

export function useSalesWithItems(
  businessId: string,
  opts?: {
    /**
     * Shopkeeper view: restrict to this SK's own sales within the current
     * calendar month only. When set, `ownerCreatorFilter` is ignored.
     */
    shopkeeperId?: string | null
    /**
     * Owner view: filter by who made the sale.
     * - 'all'    → every sale (default)
     * - 'owner'  → only sales with no shopkeeper attribution
     * - string   → only sales made by that specific shopkeeper (full history, no month cap)
     */
    ownerCreatorFilter?: 'all' | 'owner' | string
  },
) {
  const shopkeeperId = opts?.shopkeeperId ?? null
  const ownerCreatorFilter = opts?.ownerCreatorFilter ?? 'all'
  const calendarKey = useCalendarMonthKey()

  const monthBounds = useMemo(
    () => getLocalCalendarMonthBoundsMs(),
    [calendarKey, shopkeeperId],
  )

  const [salesWithItems, setSalesWithItems] = useState<SaleWithItems[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [refreshToken, setRefreshToken] = useState(0)
  const prevBusinessIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!businessId || !database) {
      setSalesWithItems([])
      setIsLoading(false)
      prevBusinessIdRef.current = undefined
      return
    }

    const businessChanged = prevBusinessIdRef.current !== businessId
    prevBusinessIdRef.current = businessId
    if (businessChanged) setIsLoading(true)

    let saleQuery: Query<SaleModel>

    if (shopkeeperId != null) {
      // Shopkeeper's own view — current calendar month only
      saleQuery = database.get<SaleModel>('sales').query(
        Q.where('business_id', businessId),
        Q.where('created_at', Q.gte(monthBounds.start)),
        Q.where('created_at', Q.lte(monthBounds.end)),
        Q.where('created_by_shopkeeper_id', shopkeeperId),
        Q.sortBy('created_at', Q.desc),
      )
    } else if (ownerCreatorFilter === 'owner') {
      // Owner wants to see only their own sales (no shopkeeper attribution)
      saleQuery = database.get<SaleModel>('sales').query(
        Q.where('business_id', businessId),
        Q.where('created_by_shopkeeper_id', Q.eq(null)),
        Q.sortBy('created_at', Q.desc),
      )
    } else if (ownerCreatorFilter !== 'all') {
      // Owner filtering by a specific shopkeeper (no month cap)
      saleQuery = database.get<SaleModel>('sales').query(
        Q.where('business_id', businessId),
        Q.where('created_by_shopkeeper_id', ownerCreatorFilter),
        Q.sortBy('created_at', Q.desc),
      )
    } else {
      // Owner default — all sales across the entire business
      saleQuery = database
        .get<SaleModel>('sales')
        .query(Q.where('business_id', businessId), Q.sortBy('created_at', Q.desc))
    }

    const subscription = saleQuery.observe().subscribe({
        next: async (salesData) => {
          try {
            if (!database) return
            const mapped = salesData.map(mapSaleRecord)

            if (mapped.length === 0) {
              setSalesWithItems([])
              setTotalCount(0)
              setIsLoading(false)
              return
            }

            const allItems = await database
              .get<SaleItemModel>('sale_items')
              .query(Q.where('sale_id', Q.oneOf(mapped.map((s) => s.id))))
              .fetch()

            const itemsBySaleId = allItems.reduce<Record<string, SaleItem[]>>(
              (acc, item) => {
                const m = mapSaleItemRecord(item)
                acc[m.saleId] = [...(acc[m.saleId] ?? []), m]
                return acc
              },
              {},
            )

            setSalesWithItems(
              mapped.map((sale) => ({
                sale,
                saleItems: itemsBySaleId[sale.id] ?? [],
              })),
            )
            setTotalCount(mapped.length)
          } catch {
            // keep existing state on error
          } finally {
            setIsLoading(false)
          }
        },
        error: () => {
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId, refreshToken, shopkeeperId, ownerCreatorFilter, monthBounds.start, monthBounds.end])

  const refetch = useCallback(() => setRefreshToken((t) => t + 1), [])

  return { salesWithItems, isLoading, totalCount, refetch }
}
