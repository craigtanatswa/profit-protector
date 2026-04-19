import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useAuthStore } from '../stores/authStore'

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Activates all automatic sync behaviour for the authenticated session:
 *  1. Initial sync on mount
 *  2. Sync when the app returns to the foreground
 *  3. Sync on a 5-minute interval while the app is open
 *
 * Call this once from app/(app)/_layout.tsx.
 */
export function useAutoSync() {
  const business = useAuthStore((s) => s.business)
  const syncStatus = useAuthStore((s) => s.syncStatus)
  const triggerSync = useAuthStore((s) => s.triggerSync)

  useEffect(() => {
    if (!business?.id) return

    const businessId = business.id

    // 1. Initial sync on mount
    triggerSync(businessId)

    // 2. Sync when user returns to the app
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && syncStatus !== 'syncing') {
        triggerSync(businessId)
      }
    })

    // 3. Periodic sync every 5 minutes
    const interval = setInterval(() => {
      if (syncStatus !== 'syncing') {
        triggerSync(businessId)
      }
    }, SYNC_INTERVAL_MS)

    return () => {
      subscription.remove()
      clearInterval(interval)
    }
  }, [business?.id])
}
