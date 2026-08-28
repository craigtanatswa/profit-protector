import { useCallback, useEffect, useState } from 'react'

import { useAuthStore } from '../stores/authStore'
import { useShops } from './useShops'
import {
  getLastUsedShopId,
  resolveDefaultShopId,
  setLastUsedShopId,
} from '../lib/shops'
import type { Shop } from '../types'

/**
 * Active catalog / sales location.
 * Single-shop businesses return shopId null (unscoped products).
 * Multi-shop owners use last-used shop; shopkeepers use their assigned shop.
 */
export function useActiveShop() {
  const businessId = useAuthStore((s) => s.business?.id ?? '')
  const activeRole = useAuthStore((s) => s.activeRole)
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const { shops, shopById, hasMultipleShops, isLoading: shopsLoading, refresh, reloadLocal } =
    useShops(businessId)
  const [selectedShopId, setSelectedShopIdState] = useState<string | null>(null)

  const assignedShopId = shopkeeperSession?.shopkeeper.shopId ?? null

  useEffect(() => {
    if (activeRole === 'shopkeeper') {
      setSelectedShopIdState(assignedShopId)
      return
    }
    if (!hasMultipleShops) {
      setSelectedShopIdState(null)
      return
    }
    let cancelled = false
    void getLastUsedShopId(businessId).then((last) => {
      if (cancelled) return
      setSelectedShopIdState((current) => {
        if (current && shops.some((shop) => shop.id === current)) return current
        return resolveDefaultShopId(shops, last)
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeRole, assignedShopId, hasMultipleShops, businessId, shops])

  const setSelectedShopId = useCallback(
    (shopId: string) => {
      setSelectedShopIdState(shopId)
      if (businessId) void setLastUsedShopId(businessId, shopId)
    },
    [businessId],
  )

  const shopId =
    activeRole === 'shopkeeper'
      ? assignedShopId
      : hasMultipleShops
        ? selectedShopId
        : null

  const activeShop: Shop | null = shopId ? shopById[shopId] ?? null : null

  return {
    shops,
    shopById,
    hasMultipleShops,
    shopsLoading,
    shopId,
    activeShop,
    setSelectedShopId,
    refresh,
    reloadLocal,
  }
}
