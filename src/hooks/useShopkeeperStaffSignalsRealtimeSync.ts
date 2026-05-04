import { useEffect, useRef } from 'react'

import { supabase } from '../lib/supabase'
import { pullShopkeeperCloudSnapshotFast } from '../lib/shopkeeperAuth'
import { useAuthStore } from '../stores/authStore'

/** If a signal arrives while a pull is already running, run once more shortly after (owner burst writes). */
const TRAILING_PULL_MS = 90

/**
 * Staff devices: subscribe to `business_staff_signals` (see `business_staff_signals_realtime.sql`).
 * Pull starts **immediately** when idle; overlapping signals only queue one trailing pull — minimal
 * latency after owner stock/sales updates without hammering the edge API on bursts.
 */
export function useShopkeeperStaffSignalsRealtimeSync() {
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const channelSuffix = useRef(`${Math.random().toString(36).slice(2, 11)}`)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pullingRef = useRef(false)

  useEffect(() => {
    if (activeRole !== 'shopkeeper' || !business?.id || !shopkeeperSession?.sessionToken) {
      return undefined
    }

    const businessId = business.id
    const token = shopkeeperSession.sessionToken
    const shopkeeperId = shopkeeperSession.shopkeeper.id

    const runPull = async () => {
      if (pullingRef.current) return
      pullingRef.current = true
      try {
        await pullShopkeeperCloudSnapshotFast(token, businessId, shopkeeperId)
      } finally {
        pullingRef.current = false
      }
    }

    const schedulePull = () => {
      if (!pullingRef.current) {
        void runPull()
        return
      }
      if (debounceRef.current != null) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void runPull()
      }, TRAILING_PULL_MS)
    }

    const channel = supabase
      .channel(`sk_staff_sig_${businessId}_${channelSuffix.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'business_staff_signals',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          schedulePull()
        },
      )
      .subscribe((status) => {
        if (__DEV__ && status === 'CHANNEL_ERROR') {
          console.warn('[shopkeeper] business_staff_signals realtime channel error — run SQL migration?')
        }
      })

    return () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current)
      debounceRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [activeRole, business?.id, shopkeeperSession?.sessionToken, shopkeeperSession?.shopkeeper.id])
}
