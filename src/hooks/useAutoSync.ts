import { useEffect, useRef } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { checkAndNotifyLowStock } from '../lib/notifications'
import { pullShopkeeperCloudSnapshotFast } from '../lib/shopkeeperAuth'
import { SHOPKEEPER_FOREGROUND_POLL_MS } from '../lib/syncPoll'

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Owners: full sync on open, resume, and every 30 minutes; low-stock digest runs on startup/resume
 * but only delivers once per local calendar day (`checkAndNotifyLowStock`).
 * Shopkeepers: `pullShopkeeperCloudSnapshotFast` (LWW) on mount, resume, ~3s foreground fallback,
 * 30 min — pairs with `useShopkeeperStaffSignalsRealtimeSync` when `business_staff_signals`
 * Realtime is enabled. An in-flight guard prevents polls from stacking if a pull takes > 3s.
 */
export function useAutoSync() {
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  // Keep a ref so the AppState listener and interval always see the latest
  // syncStatus without needing to be re-subscribed on every state change.
  const syncStatusRef = useRef(useAuthStore.getState().syncStatus)
  const triggerSync = useAuthStore((s) => s.triggerSync)
  const skPullingRef = useRef(false)

  // Keep the ref current whenever the store's syncStatus changes.
  useEffect(() => {
    return useAuthStore.subscribe(
      (state) => { syncStatusRef.current = state.syncStatus }
    )
  }, [])

  useEffect(() => {
    if (!business?.id || activeRole !== 'owner') return

    const businessId = business.id

    async function syncOnly() {
      await triggerSync(businessId)
    }

    async function initialSyncAndLowStockDigest() {
      await triggerSync(businessId)
      checkAndNotifyLowStock(businessId).catch((err) =>
        console.warn('Low stock check failed:', err.message),
      )
    }

    // 1. Defer the initial sync until after the first navigation gesture/render
    //    finishes so the screen opens immediately.
    const task = InteractionManager.runAfterInteractions(() => {
      initialSyncAndLowStockDigest().catch(() => {})
    })

    // 2. Sync when user returns to the app (use ref to check latest status).
    //    Low-stock digest runs here too but `checkAndNotifyLowStock` no-ops unless the local day
    //    hasn't had a digest yet (handles midnight rollover without app restart).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && syncStatusRef.current !== 'syncing') {
        syncOnly().catch(() => {})
        checkAndNotifyLowStock(businessId).catch((err) =>
          console.warn('Low stock check failed:', err.message),
        )
      }
    })

    // 3. Periodic sync every 30 minutes
    const interval = setInterval(() => {
      if (syncStatusRef.current !== 'syncing') {
        syncOnly().catch(() => {})
      }
    }, SYNC_INTERVAL_MS)

    return () => {
      task.cancel()
      subscription.remove()
      clearInterval(interval)
    }
  }, [activeRole, business?.id, triggerSync])

  useEffect(() => {
    if (!business?.id || activeRole !== 'shopkeeper') return

    async function shopkeeperPullAndFlush() {
      if (skPullingRef.current) return
      skPullingRef.current = true
      try {
        const sess = useAuthStore.getState().shopkeeperSession
        if (!sess?.sessionToken || !business?.id) return
        await pullShopkeeperCloudSnapshotFast(sess.sessionToken, business.id, sess.shopkeeper.id)
      } finally {
        skPullingRef.current = false
      }
    }

    void shopkeeperPullAndFlush()

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') shopkeeperPullAndFlush()
    })

    const fastPoll = setInterval(() => {
      if (AppState.currentState !== 'active') return
      shopkeeperPullAndFlush()
    }, SHOPKEEPER_FOREGROUND_POLL_MS)

    const interval = setInterval(shopkeeperPullAndFlush, SYNC_INTERVAL_MS)

    return () => {
      subscription.remove()
      clearInterval(fastPoll)
      clearInterval(interval)
    }
  }, [activeRole, business?.id])
}
