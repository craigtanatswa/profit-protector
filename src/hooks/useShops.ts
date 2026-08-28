import { useCallback, useEffect, useMemo, useState } from 'react'
import { Q } from '@nozbe/watermelondb'

import { database } from '../database'
import type ShopModel from '../database/models/Shop'
import {
  fetchRemoteShops,
  mapShopRecord,
  mergeRemoteShopsIntoWatermelon,
} from '../lib/shops'
import type { Shop } from '../types'

export function useShops(businessId: string) {
  const [shops, setShops] = useState<Shop[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadLocal = useCallback(async () => {
    if (!database || !businessId) {
      setShops([])
      setIsLoading(false)
      return
    }
    const records = await database
      .get<ShopModel>('shops')
      .query(Q.where('business_id', businessId), Q.sortBy('shop_number', Q.asc))
      .fetch()
    setShops(records.map(mapShopRecord))
    setIsLoading(false)
  }, [businessId])

  const refresh = useCallback(async () => {
    if (!businessId) {
      setShops([])
      setIsLoading(false)
      return
    }
    await loadLocal()
    try {
      const remote = await fetchRemoteShops(businessId)
      await mergeRemoteShopsIntoWatermelon(businessId, remote)
      await loadLocal()
    } catch {
      /* keep local */
    }
  }, [businessId, loadLocal])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const shopById = useMemo(() => {
    const map: Record<string, Shop> = {}
    for (const shop of shops) map[shop.id] = shop
    return map
  }, [shops])

  const hasMultipleShops = shops.length >= 2

  return {
    shops,
    shopById,
    isLoading,
    hasMultipleShops,
    refresh,
    reloadLocal: loadLocal,
  }
}
