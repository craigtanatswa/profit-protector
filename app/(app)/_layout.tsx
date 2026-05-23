import { useCallback, useEffect } from 'react'
import { Alert, AppState, StyleSheet, View } from 'react-native'
import { Tabs, router, type Href, useSegments, useUnstableGlobalHref } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Text } from 'react-native'
import * as SecureStore from 'expo-secure-store'

import { BrandLogo, StaffModeBanner, STAFF_MODE_BANNER_ROW_HEIGHT } from '../../src/components/layout'
import { AppChromeContext } from '../../src/context/AppChromeContext'
import { useAuthStore } from '../../src/stores/authStore'
import { useAutoSync } from '../../src/hooks/useAutoSync'
import { useActiveSessionGuard } from '../../src/hooks/useActiveSessionGuard'
import { useOwnerSalesRealtimeSync } from '../../src/hooks/useOwnerSalesRealtimeSync'
import { useShopkeeperStaffSignalsRealtimeSync } from '../../src/hooks/useShopkeeperStaffSignalsRealtimeSync'
import { usePendingApprovals } from '../../src/hooks/usePendingApprovals'
import { useSubscription } from '../../src/hooks/useSubscription'
import { setupNotificationHandlers, registerInAppBizNotificationSink } from '../../src/lib/notifications'
import { useNotificationBanner } from '../../src/hooks/useNotificationBanner'
import { NotificationBanner } from '../../src/components/ui/NotificationBanner'
import { clearShopkeeperSession as clearStoredShopkeeperSession } from '../../src/lib/shopkeeperAuth'
import { logActivity } from '../../src/lib/activityLogger'

const ACTIVE_COLOR = '#0047AB'
const INACTIVE_COLOR = '#718096'

// ─── Stable tab-bar icon components ─────────────────────────────────────────
// Defined at module scope so React Navigation receives the same reference on
// every render and skips unnecessary reconciliation.

type TabIconProps = { focused: boolean; color: string; size: number }

const HomeIcon = ({ focused, color, size }: TabIconProps) => (
  <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
)
const SalesIcon = ({ focused, color, size }: TabIconProps) => (
  <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
)
const InventoryIcon = ({ focused, color, size }: TabIconProps) => (
  <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
)
const ReportsIcon = ({ focused, color, size }: TabIconProps) => (
  <Ionicons name={focused ? 'bar-chart' : 'bar-chart-outline'} size={size} color={color} />
)
const CustomersIcon = ({ focused, color, size }: TabIconProps) => (
  <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />
)
const SettingsIcon = ({ focused, color, size, badgeCount = 0 }: TabIconProps & { badgeCount?: number }) => (
  <View>
    <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
    {badgeCount > 0 ? <View style={tabBadgeStyles.dot} /> : null}
  </View>
)

const tabBadgeStyles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#C0152A',
  },
})

// ─── Stable header title for Dashboard ───────────────────────────────────────
const DashboardHeaderTitle = () => (
  <View style={headerTitleStyles.row}>
    <BrandLogo variant="mark" color="blue" width={35} height={35} onBlueBackground />
    <Text style={headerTitleStyles.text}>Dashboard</Text>
  </View>
)

const headerTitleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
})

// ─── Stable tab navigator screenOptions ──────────────────────────────────────
const TAB_SCREEN_OPTIONS = {
  tabBarActiveTintColor: ACTIVE_COLOR,
  tabBarInactiveTintColor: INACTIVE_COLOR,
  tabBarStyle: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  headerStyle: { backgroundColor: '#0047AB' },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: { color: '#FFFFFF' },
  headerShadowVisible: false,
} as const

// ─── Stable screen options objects ───────────────────────────────────────────
const DASHBOARD_OPTIONS = {
  title: 'Dashboard',
  headerTitle: DashboardHeaderTitle,
  tabBarIcon: HomeIcon,
} as const

const SALES_OPTIONS = {
  title: 'Sales',
  headerShown: false,
  tabBarIcon: SalesIcon,
} as const

const INVENTORY_OPTIONS = {
  title: 'Stock',
  headerShown: false,
  tabBarIcon: InventoryIcon,
} as const

const REPORTS_OPTIONS = {
  title: 'Reports',
  headerShown: false,
  tabBarIcon: ReportsIcon,
} as const

const CUSTOMERS_OPTIONS = {
  title: 'Customers',
  headerShown: false,
  tabBarIcon: CustomersIcon,
} as const

// ─── Tab-press listener: always navigate to the root of the tab ──────────────
function tabToRoot(href: Href) {
  return {
    tabPress: (e: { preventDefault: () => void }) => {
      e.preventDefault()
      router.replace(href)
    },
  }
}

// Pre-built listener objects so they are the same reference each render
const LISTENERS = {
  dashboard: tabToRoot('/(app)'),
  sales: tabToRoot('/(app)/sales'),
  inventory: tabToRoot('/(app)/inventory'),
  reports: tabToRoot('/(app)/reports'),
  customers: tabToRoot('/(app)/customers'),
  settings: tabToRoot('/(app)/settings'),
} as const

export default function AppLayout() {
  useAutoSync()
  useActiveSessionGuard()
  useOwnerSalesRealtimeSync()
  useShopkeeperStaffSignalsRealtimeSync()

  const isLoadingAuth = useAuthStore((s) => s.isLoading)
  const user = useAuthStore((s) => s.user)
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const clearShopkeeperSession = useAuthStore((s) => s.clearShopkeeperSession)
  const isShopkeeper = activeRole === 'shopkeeper'
  const { pendingRequests } = usePendingApprovals(
    activeRole === 'owner' ? business?.id ?? '' : '',
  )

  const segments = useSegments()
  const unstableHref = useUnstableGlobalHref()
  const paywallFocused =
    segments.includes('paywall') ||
    (typeof unstableHref === 'string' && unstableHref.includes('paywall'))
  const {
    canUseApp,
    isLoading: subscriptionLoading,
    refetch: refetchSubscription,
    subscription,
    daysRemainingInTrial,
  } = useSubscription()

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refetchSubscription()
    })
    return () => sub.remove()
  }, [refetchSubscription])

  useEffect(() => {
    if (isLoadingAuth || subscriptionLoading) return
    if (activeRole === 'owner' && canUseApp && paywallFocused) {
      router.replace('/(app)')
    }
  }, [activeRole, canUseApp, isLoadingAuth, paywallFocused, subscriptionLoading])

  useEffect(() => {
    if (isLoadingAuth || subscriptionLoading) return
    if (activeRole !== 'owner' || canUseApp) return
    if (paywallFocused) return
    router.replace('/(app)/paywall')
  }, [activeRole, canUseApp, isLoadingAuth, paywallFocused, subscriptionLoading])

  // Show a one-time "welcome — you have a 30-day trial" alert on the very
  // first login after a new account is created.
  useEffect(() => {
    if (isLoadingAuth || subscriptionLoading) return
    if (activeRole !== 'owner') return
    if (subscription?.status !== 'trial') return
    if (!business?.id) return

    const key = `trial_welcome_shown_${business.id}`
    void SecureStore.getItemAsync(key).then((shown) => {
      if (shown) return
      void SecureStore.setItemAsync(key, '1')
      Alert.alert(
        'Welcome to Profit Protector!',
        `You have a ${daysRemainingInTrial}-day free trial — no payment needed yet.\n\nExplore all features and start protecting your business profits today.`,
        [{ text: 'Get Started', style: 'default' }],
      )
    })
  }, [
    activeRole,
    business?.id,
    daysRemainingInTrial,
    isLoadingAuth,
    subscription?.status,
    subscriptionLoading,
  ])

  /** Accounts that verified phone but never finished `createBusinessProfile` (e.g. older builds). */
  useEffect(() => {
    if (isShopkeeper || isLoadingAuth || !user || business != null) return
    router.replace('/(auth)/register?resume=1')
  }, [business, isLoadingAuth, isShopkeeper, user])

  const { bannerProps, showBanner, hideBanner } = useNotificationBanner()

  // Set up tap-on-notification navigation handlers
  useEffect(() => {
    const cleanup = setupNotificationHandlers()
    return cleanup
  }, [])

  // In-session business alerts (low stock, staff sales) bypass OS notifications and use this sink.
  useEffect(() => {
    registerInAppBizNotificationSink((payload) => {
      const d = payload.data
      const nType = d?.type
      const screen = d?.screen
      const navigateHref =
        screen === 'sales' || nType === 'staff_sale'
          ? '/(app)/sales'
          : screen === 'inventory'
            ? '/(app)/inventory'
            : null
      showBanner({
        title: payload.title || 'Alert',
        message: payload.body,
        type: nType === 'out_of_stock' ? 'danger' : 'warning',
        productId: d?.productId ?? null,
        navigateHref,
      })
    })
    return () => registerInAppBizNotificationSink(null)
  }, [showBanner])

  const handleBannerPress = useCallback(() => {
    hideBanner()
    if (bannerProps.navigateHref) {
      router.push(bannerProps.navigateHref as Href)
      return
    }
    if (bannerProps.productId) {
      router.push({
        pathname: '/(app)/inventory/[id]',
        params: { id: bannerProps.productId },
      })
    }
  }, [hideBanner, bannerProps.navigateHref, bannerProps.productId])

  const handleShopkeeperSignOut = useCallback(() => {
    Alert.alert('Sign out?', 'Return to the login screen?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logActivity({ action: 'account_logout', entityType: 'account' })
          await clearStoredShopkeeperSession()
          clearShopkeeperSession()
          router.replace('/(auth)/login')
        },
      },
    ])
  }, [clearShopkeeperSession])

  const settingsOptions = {
    title: 'Settings',
    headerShown: false,
    tabBarIcon: (props: TabIconProps) => (
      <SettingsIcon {...props} badgeCount={pendingRequests.length} />
    ),
  } as const

  return (
    <AppChromeContext.Provider value={{ staffBannerConsumesTopSafeArea: isShopkeeper }}>
      <View style={rootStyle}>
        {isShopkeeper ? (
          <StaffModeBanner
            shopkeeperName={shopkeeperSession?.shopkeeper.fullName ?? ''}
            onSignOut={handleShopkeeperSignOut}
          />
        ) : null}

        <NotificationBanner
          {...bannerProps}
          topOffsetExtra={isShopkeeper ? STAFF_MODE_BANNER_ROW_HEIGHT : 0}
          onPress={handleBannerPress}
          onDismiss={hideBanner}
        />

        <Tabs screenOptions={TAB_SCREEN_OPTIONS}>
          <Tabs.Screen
            name="index"
            listeners={LISTENERS.dashboard}
            options={DASHBOARD_OPTIONS}
          />
          <Tabs.Screen
            name="sales"
            listeners={LISTENERS.sales}
            options={SALES_OPTIONS}
          />
          <Tabs.Screen
            name="inventory"
            listeners={LISTENERS.inventory}
            options={INVENTORY_OPTIONS}
          />
          <Tabs.Screen
            name="reports"
            listeners={isShopkeeper ? undefined : LISTENERS.reports}
            options={{
              ...REPORTS_OPTIONS,
              ...(isShopkeeper ? { href: null } : {}),
            }}
          />
          <Tabs.Screen
            name="customers"
            listeners={LISTENERS.customers}
            options={CUSTOMERS_OPTIONS}
          />
          <Tabs.Screen
            name="settings"
            listeners={LISTENERS.settings}
            options={settingsOptions}
          />
          <Tabs.Screen
            name="notifications"
            options={{ href: null, headerShown: false }}
          />
          <Tabs.Screen
            name="paywall"
            options={{
              href: null,
              headerShown: false,
              tabBarStyle: { display: 'none', height: 0 },
              tabBarItemStyle: { height: 0, width: 0, overflow: 'hidden' },
            }}
          />
        </Tabs>
      </View>
    </AppChromeContext.Provider>
  )
}

const rootStyle = { flex: 1 }
