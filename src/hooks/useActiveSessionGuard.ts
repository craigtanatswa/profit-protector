import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { router } from 'expo-router'

import {
  ensureOwnerActiveSession,
  SESSION_SUPERSEDED_MESSAGE,
} from '../lib/activeSession'
import { clearShopkeeperSession as clearStoredShopkeeperSession, verifyShopkeeperSessionActive } from '../lib/shopkeeperAuth'
import { useAuthStore } from '../stores/authStore'

const CHECK_INTERVAL_MS = 30_000

/**
 * Enforces single-device login for owners and shopkeepers.
 * On foreground and periodically while active, validates that this device
 * still holds the active session; otherwise signs out with an alert.
 */
export function useActiveSessionGuard() {
  const activeRole = useAuthStore((s) => s.activeRole)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const kickingRef = useRef(false)

  useEffect(() => {
    if (isLoading) return

    const inSession =
      (activeRole === 'owner' && isAuthenticated) || activeRole === 'shopkeeper'
    if (!inSession) return

    async function forceLogout() {
      if (kickingRef.current) return
      kickingRef.current = true

      Alert.alert('Signed out', SESSION_SUPERSEDED_MESSAGE, [
        {
          text: 'OK',
          onPress: () => {
            void (async () => {
              const role = useAuthStore.getState().activeRole
              if (role === 'shopkeeper') {
                await clearStoredShopkeeperSession()
                useAuthStore.getState().clearShopkeeperSession()
              } else {
                await useAuthStore.getState().logout()
              }
              router.replace('/(auth)/login')
            })()
          },
        },
      ])
    }

    async function checkSession() {
      if (AppState.currentState !== 'active') return

      if (activeRole === 'owner' && isAuthenticated) {
        const result = await ensureOwnerActiveSession()
        if (result === 'superseded') {
          await forceLogout()
        }
        return
      }

      if (activeRole === 'shopkeeper') {
        const superseded = await verifyShopkeeperSessionActive()
        if (superseded) {
          await forceLogout()
        }
      }
    }

    void checkSession()

    const onAppState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkSession()
    })

    const interval = setInterval(() => {
      void checkSession()
    }, CHECK_INTERVAL_MS)

    return () => {
      onAppState.remove()
      clearInterval(interval)
    }
  }, [activeRole, isAuthenticated, isLoading])
}
