import { useEffect } from 'react'
import { View } from 'react-native'
import { Tabs, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Text } from 'react-native'
import * as Notifications from 'expo-notifications'

import { BrandLogo } from '../../src/components/layout'
import { useAutoSync } from '../../src/hooks/useAutoSync'
import { setupNotificationHandlers } from '../../src/lib/notifications'
import { useNotificationBanner } from '../../src/hooks/useNotificationBanner'
import { NotificationBanner } from '../../src/components/ui/NotificationBanner'

const ACTIVE_COLOR = '#0047AB'
const INACTIVE_COLOR = '#718096'

export default function AppLayout() {
  useAutoSync()

  const { bannerProps, showBanner, hideBanner } = useNotificationBanner()

  // Set up tap-on-notification navigation handlers
  useEffect(() => {
    const cleanup = setupNotificationHandlers()
    return cleanup
  }, [])

  // Show in-app banner when a notification arrives while app is open
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content
      showBanner({
        title: title ?? 'Stock Alert',
        message: body ?? '',
        type: (data as Record<string, string>)?.type === 'out_of_stock' ? 'danger' : 'warning',
        productId: (data as Record<string, string>)?.productId ?? null,
      })
    })
    return () => sub.remove()
  }, [showBanner])

  return (
    <View style={{ flex: 1 }}>
      <NotificationBanner
        {...bannerProps}
        onPress={() => {
          hideBanner()
          if (bannerProps.productId) {
            router.push({
              pathname: '/(app)/inventory/[id]',
              params: { id: bannerProps.productId },
            })
          }
        }}
        onDismiss={hideBanner}
      />

      <Tabs
        screenOptions={{
          tabBarActiveTintColor: ACTIVE_COLOR,
          tabBarInactiveTintColor: INACTIVE_COLOR,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: '#E9ECEF',
          },
          headerStyle: {
            backgroundColor: '#FFFFFF',
          },
          headerTintColor: '#0047AB',
          headerShadowVisible: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            headerTitle: () => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <BrandLogo variant="full" width={32} height={32} />
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#1A202C' }}>Dashboard</Text>
              </View>
            ),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'home' : 'home-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="sales"
          options={{
            title: 'Sales',
            headerShown: false,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'receipt' : 'receipt-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Stock',
            headerShown: false,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'cube' : 'cube-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reports',
            headerShown: false,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'bar-chart' : 'bar-chart-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="customers"
          options={{
            title: 'Customers',
            headerShown: false,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'people' : 'people-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerShown: false,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? 'settings' : 'settings-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
      </Tabs>
    </View>
  )
}
