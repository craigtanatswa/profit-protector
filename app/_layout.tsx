import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DatabaseProvider } from '@nozbe/watermelondb/react'
import { database } from '../src/database'
import { supabase } from '../src/lib/supabase'
import { useAuthStore } from '../src/stores/authStore'
import { useOnboardingStore } from '../src/stores/onboardingStore'
import { LoadingScreen } from '../src/components/ui/LoadingScreen'
import { requestNotificationPermissions } from '../src/lib/notifications'
import {
  clearShopkeeperSession as clearStoredShopkeeperSession,
  getStoredShopkeeperSession,
} from '../src/lib/shopkeeperAuth'
import "../global.css"

// Always clear the stored session on cold start in dev so the login screen
// is shown by default — makes manual testing of login/register easy.
const clearAuthOnColdStartDev = __DEV__

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
  const hydrated = useOnboardingStore((s) => s.hydrated)
  const hasCompletedOnboarding = useOnboardingStore((s) => s.hasCompletedOnboarding)
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrateFromStorage)
  const markCompletedSyncedWithAuth = useOnboardingStore((s) => s.markCompletedSyncedWithAuth)

  useEffect(() => {
    const bootstrap = async () => {
      if (clearAuthOnColdStartDev) {
        await supabase.auth.signOut()
        setBusiness(null)
        setUser(null)
      }
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
      await hydrateOnboarding()
    }
    void bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
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
      if (
        (inAuth && !keepAuthShell) ||
        (inOnboarding && !keepOnboardingShell)
      ) {
        router.replace('/(app)')
      }
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
    requestNotificationPermissions().then((granted) => {
      if (granted) {
        console.log('Notifications permission granted')
      }
    })
  }, [])

  const shell = (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthGate />
    </SafeAreaProvider>
  )
  if (database) {
    return <DatabaseProvider database={database}>{shell}</DatabaseProvider>
  }
  return shell
}
