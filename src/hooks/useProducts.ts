import { useCallback, useEffect, useState } from 'react'
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

export function useProducts(businessId: string) {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!businessId || !database) {
      setProducts([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

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
  }, [businessId, refreshTick])

  const refetch = useCallback(() => setRefreshTick((t) => t + 1), [])

  return { products, isLoading, error, refetch }
}
