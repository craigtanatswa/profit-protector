import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Product } from '../types'
import type ProductModel from '../database/models/Product'

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

export async function getProductById(id: string): Promise<Product> {
  if (!database) throw new Error('Database not available')
  const record = await database.get<ProductModel>('products').find(id)
  return mapProductRecord(record)
}

/**
 * useProducts
 *
 * Subscribes to the products collection via WatermelonDB's `observe()`.
 * The subscription is permanent for the lifetime of a given businessId —
 * it is never torn down by `refetch()` calls, so there is no race window
 * where a background-sync write could be silently missed.
 *
 * When WatermelonDB is updated (e.g. by `mergeRemoteProductsIntoWatermelon`
 * after a sync), `observe()` fires immediately and `setProducts` pushes new
 * data into React state, re-rendering all subscribers without any manual
 * refresh trigger.
 *
 * `refetch()` is intentionally a no-op — the live observable already handles
 * all updates. Call sites that still invoke refetch() after a pull are safe
 * to leave as-is; they just become a harmless extra call.
 */
export function useProducts(businessId: string) {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const prevBusinessIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!businessId || !database) {
      setProducts([])
      setIsLoading(false)
      prevBusinessIdRef.current = undefined
      return
    }

    const businessChanged = prevBusinessIdRef.current !== businessId
    prevBusinessIdRef.current = businessId
    if (businessChanged) setIsLoading(true)

    const subscription = database
      .get<ProductModel>('products')
      .query(
        Q.where('business_id', businessId),
        Q.where('is_active', true),
        Q.sortBy('name', Q.asc),
      )
      .observe()
      .subscribe({
        next: (records) => {
          setProducts(records.map(mapProductRecord))
          setIsLoading(false)
        },
        error: (err) => {
          setError((err as Error).message)
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId]) // No refreshTick — observe() is always live and fires on every write.

  // No-op: the live observable already fires on every WatermelonDB write.
  // Kept for API compatibility with existing call sites.
  const refetch = useCallback(() => {}, [])

  return { products, isLoading, error, refetch }
}
