import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Sale, SaleItem } from '../types'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'

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

export function useSalesWithItems(businessId: string) {
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

    const subscription = database
      .get<SaleModel>('sales')
      .query(
        Q.where('business_id', businessId),
        Q.sortBy('created_at', Q.desc),
      )
      .observe()
      .subscribe({
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
  }, [businessId, refreshToken])

  const refetch = () => setRefreshToken((t) => t + 1)

  return { salesWithItems, isLoading, totalCount, refetch }
}
