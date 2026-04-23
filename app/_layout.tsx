import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { DatabaseProvider } from '@nozbe/watermelondb/react'
import { database } from '../src/database'
import { supabase } from '../src/lib/supabase'
import { useAuthStore } from '../src/stores/authStore'
import { LoadingScreen } from '../src/components/ui/LoadingScreen'
import { requestNotificationPermissions } from '../src/lib/notifications'
import "../global.css"

// Always clear the stored session on cold start in dev so the login screen
// is shown by default — makes manual testing of login/register easy.
const clearAuthOnColdStartDev = __DEV__

function AuthGate() {
  const router = useRouter()
  const segments = useSegments()
  const { isAuthenticated, isLoading, setUser, initializeAuth } = useAuthStore()

  useEffect(() => {
    const bootstrap = async () => {
      if (clearAuthOnColdStartDev) {
        await supabase.auth.signOut()
        const { setBusiness } = useAuthStore.getState()
        setBusiness(null)
        setUser(null)
      }
      await initializeAuth()
    }
    void bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [initializeAuth, setUser])

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(app)')
    }
  }, [isAuthenticated, isLoading, segments, router])

  if (isLoading) {
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
    <>
      <StatusBar style="dark" />
      <AuthGate />
    </>
  )
  if (database) {
    return <DatabaseProvider database={database}>{shell}</DatabaseProvider>
  }
  return shell
}
