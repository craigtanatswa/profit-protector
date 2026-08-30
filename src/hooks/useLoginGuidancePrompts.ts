import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { router } from 'expo-router'

import { database } from '../database'
import { queueTutorial } from '../lib/tutorialReplay'

async function countActiveProducts(businessId: string): Promise<number> {
  if (!database) return 0
  return database
    .get('products')
    .query(Q.where('business_id', businessId), Q.where('is_active', true))
    .fetchCount()
}

async function countSales(businessId: string): Promise<number> {
  if (!database) return 0
  return database.get('sales').query(Q.where('business_id', businessId)).fetchCount()
}

/**
 * After login (once per owner session), ask if they want guidance when they
 * still have no products, or products but no sales.
 */
export function useLoginGuidancePrompts(options: {
  enabled: boolean
  businessId: string | undefined
  hold: boolean
}) {
  const { enabled, businessId, hold } = options
  const [showProductGuidance, setShowProductGuidance] = useState(false)
  const [showSalesGuidance, setShowSalesGuidance] = useState(false)
  const checkedForBusinessRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !businessId || hold) return
    if (checkedForBusinessRef.current === businessId) return

    let cancelled = false

    void (async () => {
      const productCount = await countActiveProducts(businessId)
      if (cancelled) return

      if (productCount === 0) {
        checkedForBusinessRef.current = businessId
        setShowProductGuidance(true)
        return
      }

      const salesCount = await countSales(businessId)
      if (cancelled) return

      checkedForBusinessRef.current = businessId
      if (salesCount === 0) {
        setShowSalesGuidance(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, businessId, hold])

  const dismissProductGuidance = useCallback(() => {
    setShowProductGuidance(false)
  }, [])

  const acceptProductGuidance = useCallback(() => {
    setShowProductGuidance(false)
    queueTutorial('product')
    router.replace('/(app)/inventory')
  }, [])

  const dismissSalesGuidance = useCallback(() => {
    setShowSalesGuidance(false)
  }, [])

  const acceptSalesGuidance = useCallback(() => {
    setShowSalesGuidance(false)
    queueTutorial('sales')
    router.replace('/(app)/sales')
  }, [])

  return {
    showProductGuidance,
    showSalesGuidance,
    acceptProductGuidance,
    dismissProductGuidance,
    acceptSalesGuidance,
    dismissSalesGuidance,
  }
}
