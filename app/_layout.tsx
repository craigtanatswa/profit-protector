import '../src/lib/alertAndroidPatch'
import { useEffect, useLayoutEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DatabaseProvider } from '@nozbe/watermelondb/react'
import { database } from '../src/database'
import { supabase } from '../src/lib/supabase'
import { useAuthStore } from '../src/stores/authStore'
import { useOnboardingStore } from '../src/stores/onboardingStore'
import { AppAlertProvider } from '../src/components/ui/AppAlertProvider'
import { LoadingScreen } from '../src/components/ui/LoadingScreen'
import { setBusinessAlertsPreferInAppOnly } from '../src/lib/notificationDeliveryMode'
import { ensureOwnerPushTokenRegistered } from '../src/lib/expoPushRemote'
import {
  clearShopkeeperSession as clearStoredShopkeeperSession,
  getStoredShopkeeperSession,
} from '../src/lib/shopkeeperAuth'
import "../global.css"

/** Signed-in users stay on these (auth) screens until they navigate away — avoids kicking signup off Register after OTP before `createBusinessProfile`. */
const AUTH_SCREENS_KEEP_WHEN_AUTHENTICATED = new Set([
  'register',
  'phone-verify',
  'terms-of-service',
  'privacy-policy',
  'login',
])

/** Stay on convert while authenticated so signup finishes before entering the app. */
const ONBOARDING_SCREENS_KEEP_WHEN_AUTHENTICATED = new Set(['convert'])

function AuthGate() {
  const router = useRouter()
  const segments = useSegments()
  const {
    activeRole,
    isAuthenticated,
    isLoading,
    setActiveRole,
    setBusiness,
    setShopkeeperSession,
    setUser,
    initializeAuth,
  } = useAuthStore()
  const business = useAuthStore((s) => s.business)
  const hydrated = useOnboardingStore((s) => s.hydrated)
  const hasCompletedOnboarding = useOnboardingStore((s) => s.hasCompletedOnboarding)
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrateFromStorage)
  const markCompletedSyncedWithAuth = useOnboardingStore((s) => s.markCompletedSyncedWithAuth)

  useLayoutEffect(() => {
    const inSession = isAuthenticated || activeRole === 'shopkeeper'
    setBusinessAlertsPreferInAppOnly(inSession)
  }, [isAuthenticated, activeRole])

  useEffect(() => {
    if (!isAuthenticated || activeRole !== 'owner' || isLoading) return
    void ensureOwnerPushTokenRegistered()
  }, [isAuthenticated, activeRole, isLoading])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await initializeAuth()
        const { isAuthenticated: ownerAuthenticated } = useAuthStore.getState()
        if (ownerAuthenticated) {
          await clearStoredShopkeeperSession()
          setActiveRole('owner')
          setShopkeeperSession(null)
        } else {
          const staffSession = await getStoredShopkeeperSession()
          if (staffSession) {
            setUser(null)
            setBusiness({
              id: staffSession.businessId,
              name: staffSession.businessName,
              ownerName: staffSession.shopkeeper.fullName,
              phone: '',
              businessType: '',
              currency: 'USD',
              zigRatePerUsd: 1,
              recoveryEmailVerified: false,
            })
            setActiveRole('shopkeeper')
            setShopkeeperSession(staffSession)
          }
        }
      } finally {
        await hydrateOnboarding()
      }
    }
    void bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        void (async () => {
          const { handleOwnerAuthStateChange } = await import('../src/lib/sessionPersistence')
          const nextSession = await handleOwnerAuthStateChange(event, session)
          setUser(nextSession?.user ?? null)
        })()
      },
    )

    return () => subscription.unsubscribe()
  }, [
    hydrateOnboarding,
    initializeAuth,
    setActiveRole,
    setBusiness,
    setShopkeeperSession,
    setUser,
  ])

  useEffect(() => {
    if (isLoading || !hydrated) return

    const segmentList = segments as readonly string[]
    const first = segmentList[0]
    const inOnboarding = first === '(onboarding)'
    const inAuth = first === '(auth)'
    const authLeaf =
      typeof segmentList[1] === 'string' ? segmentList[1] : undefined
    const keepAuthShell =
      inAuth &&
      authLeaf != null &&
      AUTH_SCREENS_KEEP_WHEN_AUTHENTICATED.has(authLeaf)

    const onboardingLeaf =
      typeof segmentList[1] === 'string' ? segmentList[1] : undefined
    const keepOnboardingShell =
      inOnboarding &&
      onboardingLeaf != null &&
      ONBOARDING_SCREENS_KEEP_WHEN_AUTHENTICATED.has(onboardingLeaf)

    if (activeRole === 'shopkeeper') {
      const inApp = first === '(app)'
      if (inApp) return
      router.replace('/(app)')
      return
    }

    if (isAuthenticated) {
      if (!hasCompletedOnboarding) {
        void markCompletedSyncedWithAuth()
      }
      const inApp = first === '(app)'
      if (inApp) return
      if (inAuth && keepAuthShell) return
      if (inOnboarding && keepOnboardingShell) return
      if (business == null) {
        router.replace('/(auth)/login')
        return
      }
      router.replace('/(app)')
      return
    }

    if (!hasCompletedOnboarding) {
      if (!inOnboarding && !inAuth) {
        router.replace('/(onboarding)/welcome')
      }
      return
    }

    if (!inAuth) {
      router.replace('/(auth)/login')
    }
  }, [
    isAuthenticated,
    activeRole,
    isLoading,
    hydrated,
    hasCompletedOnboarding,
    business,
    segments,
    router,
    markCompletedSyncedWithAuth,
  ])

  if (isLoading || !hydrated) {
    return <LoadingScreen />
  }

  return <Slot />
}

export default function RootLayout() {
  useEffect(() => {
    void ensureOwnerPushTokenRegistered()
  }, [])

  const shell = (
    <AppAlertProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthGate />
      </SafeAreaProvider>
    </AppAlertProvider>
  )
  if (database) {
    return <DatabaseProvider database={database}>{shell}</DatabaseProvider>
  }
  return shell
}
