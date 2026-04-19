import { useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Product, StockMovement } from '../types'
import type ProductModel from '../database/models/Product'
import type StockMovementModel from '../database/models/StockMovement'

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

function mapMovementRecord(record: StockMovementModel): StockMovement {
  return {
    id: record.id,
    businessId: record.businessId,
    productId: record.productId,
    productNameSnapshot: record.productNameSnapshot,
    action: record.action as StockMovement['action'],
    qtyChange: record.qtyChange,
    reason: record.reason ?? undefined,
    supplier: record.supplier ?? undefined,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

export function useProductDetail(productId: string) {
  const [product, setProduct] = useState<Product | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [productLoaded, setProductLoaded] = useState(false)
  const [movementsLoaded, setMovementsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshFromLocalRef = useRef<() => Promise<void>>(async () => {})

  const isLoading = !productLoaded || !movementsLoaded

  useEffect(() => {
    if (!productId || !database) {
      refreshFromLocalRef.current = async () => {}
      setProduct(null)
      setError('Product not found')
      setProductLoaded(true)
      setMovementsLoaded(true)
      return
    }

    const productSub = database
      .get<ProductModel>('products')
      .query(Q.where('id', productId))
      .observe()
      .subscribe({
        next: (records) => {
          if (records.length === 0) {
            setProduct(null)
            setError('Product not found')
          } else {
            setProduct(mapProductRecord(records[0]))
            setError(null)
          }
          setProductLoaded(true)
        },
        error: (err) => {
          setProduct(null)
          setError((err as Error).message ?? 'Product not found')
          setProductLoaded(true)
        },
      })

    // Load full history for this product. Do not use Q.take(N) with desc sort —
    // that drops the oldest rows (including the first “received stock” purchase)
    // whenever total movements exceed N.
    const movementsSub = database
      .get<StockMovementModel>('stock_movements')
      .query(Q.where('product_id', productId), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe({
        next: (records) => {
          setMovements(records.map(mapMovementRecord))
          setMovementsLoaded(true)
        },
        error: (err) => {
          console.warn('[useProductDetail] movements subscription error:', err)
          setMovements([])
          setMovementsLoaded(true)
        },
      })

    refreshFromLocalRef.current = async () => {
      if (!database || !productId) return
      try {
        const p = await database.get<ProductModel>('products').find(productId)
        setProduct(mapProductRecord(p))
        setError(null)
        setProductLoaded(true)
        const m = await database
          .get<StockMovementModel>('stock_movements')
          .query(Q.where('product_id', productId), Q.sortBy('created_at', Q.desc))
          .fetch()
        setMovements(m.map(mapMovementRecord))
        setMovementsLoaded(true)
      } catch {
        // keep last snapshot
      }
    }

    return () => {
      productSub.unsubscribe()
      movementsSub.unsubscribe()
    }
  }, [productId])

  return {
    product,
    movements,
    isLoading,
    error,
    refreshFromLocal: () => refreshFromLocalRef.current(),
  }
}
