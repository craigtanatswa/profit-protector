import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Product } from '../types'
import type ProductModel from '../database/models/Product'
import { normalizeTrackingMode } from '../lib/cutProducts'

export function mapProductRecord(record: ProductModel): Product {
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    category: record.category ?? undefined,
    unit: record.unit,
    trackingMode: normalizeTrackingMode(record.trackingMode),
    costPriceCents: record.costPriceCents,
    sellingPriceCents: record.sellingPriceCents,
    stockQty: record.stockQty,
    lowStockThreshold: record.lowStockThreshold,
    isActive: record.isActive,
    shopId: record.shopId ?? null,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.getTime() : Date.now(),
  }
}

export async function getProductById(id: string): Promise<Product> {
  if (!database) throw new Error('Database not available')
  const record = await database.get<ProductModel>('products').find(id)
  return mapProductRecord(record)
}

export type UseProductsOptions = {
  /** When set, only products in this shop's catalog. */
  shopId?: string | null
  /**
   * When true, do not load the full business catalog if shopId is missing.
   * Use while the active shop is still resolving.
   */
  scopedToShop?: boolean
}

/**
 * useProducts
 *
 * Subscribes to the products collection via WatermelonDB's `observe()`.
 * Optionally scoped to one shop catalog when the business has multiple locations.
 */
export function useProducts(businessId: string, options?: UseProductsOptions) {
  const shopId = options?.shopId ?? null
  const scopedToShop = options?.scopedToShop === true
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const prevKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!businessId || !database) {
      setProducts([])
      setIsLoading(false)
      prevKeyRef.current = undefined
      return
    }

    if (scopedToShop && !shopId) {
      setProducts([])
      setIsLoading(false)
      return
    }

    const key = `${businessId}:${shopId ?? ''}`
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key
      setIsLoading(true)
    }

    const clauses = [
      Q.where('business_id', businessId),
      Q.where('is_active', true),
      Q.sortBy('name', Q.asc),
    ]
    if (shopId) clauses.splice(2, 0, Q.where('shop_id', shopId))

    const subscription = database
      .get<ProductModel>('products')
      .query(...clauses)
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
  }, [businessId, shopId, scopedToShop])

  const refetch = useCallback(() => {}, [])

  return { products, isLoading, error, refetch }
}
