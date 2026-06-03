import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from 'expo-router'

import { useAuthStore } from '../stores/authStore'
import { checkShopkeeperStockAccess, requestShopkeeperStockAccess } from '../lib/shopkeeperAuth'
import type { StockAccessType } from '../types'

/**
 * Gate hook for shopkeeper screens that require owner approval per action type:
 * `receive` (add/receive stock) vs `adjust` (stock adjustments). Each has its own 24h grant.
 */
export function useShopkeeperStockAccessGate() {
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const activeRole = useAuthStore((s) => s.activeRole)

  const [pendingVisible, setPendingVisible] = useState(false)
  const [pendingAccessType, setPendingAccessType] = useState<StockAccessType>('receive')
  const onGrantedCallbackRef = useRef<(() => void) | null>(null)
  const pendingAccessTypeRef = useRef<StockAccessType>('receive')
  const navigateBackOnCancelRef = useRef(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const shopkeeperName = shopkeeperSession?.shopkeeper.fullName ?? ''

  useEffect(() => {
    const token = shopkeeperSession?.sessionToken
    const accessType = pendingAccessTypeRef.current
    if (!pendingVisible || !token) {
      if (pollingRef.current != null) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      return undefined
    }

    pollingRef.current = setInterval(() => {
      void (async () => {
        try {
          const status = await checkShopkeeperStockAccess(token, accessType)
          if (status === 'granted') {
            const cb = onGrantedCallbackRef.current
            onGrantedCallbackRef.current = null
            navigateBackOnCancelRef.current = false
            setPendingVisible(false)
            cb?.()
          } else if (status === 'denied') {
            onGrantedCallbackRef.current = null
            const shouldNavigateBack = navigateBackOnCancelRef.current
            navigateBackOnCancelRef.current = false
            setPendingVisible(false)
            if (shouldNavigateBack && router.canGoBack()) router.back()
          }
        } catch {
          /* ignore transient network errors during poll */
        }
      })()
    }, 10_000)

    return () => {
      if (pollingRef.current != null) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [pendingVisible, shopkeeperSession?.sessionToken])

  const ensureStockAccess = useCallback(
    async (accessType: StockAccessType, onGranted?: () => void) => {
      if (activeRole !== 'shopkeeper') {
        onGranted?.()
        return
      }

      const token = shopkeeperSession?.sessionToken
      if (!token) {
        if (onGranted === undefined && router.canGoBack()) router.back()
        return
      }

      pendingAccessTypeRef.current = accessType
      setPendingAccessType(accessType)
      navigateBackOnCancelRef.current = onGranted === undefined

      try {
        const status = await checkShopkeeperStockAccess(token, accessType)

        if (status === 'granted') {
          navigateBackOnCancelRef.current = false
          onGranted?.()
          return
        }

        if (status === 'pending') {
          onGrantedCallbackRef.current = onGranted ?? null
          setPendingVisible(true)
          return
        }

        const newStatus = await requestShopkeeperStockAccess(token, accessType)

        if (newStatus === 'granted') {
          navigateBackOnCancelRef.current = false
          onGranted?.()
          return
        }

        onGrantedCallbackRef.current = onGranted ?? null
        setPendingVisible(true)
      } catch {
        if (onGranted === undefined && router.canGoBack()) router.back()
      }
    },
    [activeRole, shopkeeperSession?.sessionToken],
  )

  const closePending = useCallback(() => {
    onGrantedCallbackRef.current = null
    const shouldNavigateBack = navigateBackOnCancelRef.current
    navigateBackOnCancelRef.current = false
    setPendingVisible(false)
    if (shouldNavigateBack && router.canGoBack()) {
      router.back()
    }
  }, [])

  return {
    ensureStockAccess,
    pendingVisible,
    pendingAccessType,
    closePending,
    shopkeeperName,
  }
}
