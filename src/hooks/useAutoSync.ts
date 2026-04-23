import { useEffect, useRef } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { checkAndNotifyLowStock } from '../lib/notifications'

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Activates all automatic sync behaviour for the authenticated session:
 *  1. Initial sync on mount (deferred until after interactions settle)
 *  2. Sync when the app returns to the foreground
 *  3. Sync on a 30-minute interval while the app is open
 *  4. Runs a batch low stock check after each successful sync
 *
 * Call this once from app/(app)/_layout.tsx.
 */
export function useAutoSync() {
  const business = useAuthStore((s) => s.business)
  // Keep a ref so the AppState listener and interval always see the latest
  // syncStatus without needing to be re-subscribed on every state change.
  const syncStatusRef = useRef(useAuthStore.getState().syncStatus)
  const triggerSync = useAuthStore((s) => s.triggerSync)

  // Keep the ref current whenever the store's syncStatus changes.
  useEffect(() => {
    return useAuthStore.subscribe(
      (state) => { syncStatusRef.current = state.syncStatus }
    )
  }, [])

  useEffect(() => {
    if (!business?.id) return

    const businessId = business.id

    async function syncAndCheck() {
      await triggerSync(businessId)
      checkAndNotifyLowStock(businessId).catch((err) =>
        console.warn('Low stock check failed:', err.message),
      )
    }

    // 1. Defer the initial sync until after the first navigation gesture/render
    //    finishes so the screen opens immediately.
    const task = InteractionManager.runAfterInteractions(() => {
      syncAndCheck().catch(() => {})
    })

    // 2. Sync when user returns to the app (use ref to check latest status)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && syncStatusRef.current !== 'syncing') {
        syncAndCheck().catch(() => {})
      }
    })

    // 3. Periodic sync every 30 minutes
    const interval = setInterval(() => {
      if (syncStatusRef.current !== 'syncing') {
        syncAndCheck().catch(() => {})
      }
    }, SYNC_INTERVAL_MS)

    return () => {
      task.cancel()
      subscription.remove()
      clearInterval(interval)
    }
  }, [business?.id, triggerSync])
}
