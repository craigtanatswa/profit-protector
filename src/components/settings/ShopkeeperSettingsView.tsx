import React, { useCallback } from 'react'
import { Alert, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { ScreenHeader } from '../layout'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import { useAuthStore } from '../../stores/authStore'
import { clearShopkeeperSession as clearStoredShopkeeperSession } from '../../lib/shopkeeperAuth'
import { logActivity } from '../../lib/activityLogger'

export function ShopkeeperSettingsView() {
  const router = useRouter()
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const clearShopkeeperSession = useAuthStore((s) => s.clearShopkeeperSession)

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out?', 'Return to the login screen?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logActivity({ action: 'account_logout', entityType: 'account' })
          await clearStoredShopkeeperSession()
          clearShopkeeperSession()
          router.replace('/(auth)/login')
        },
      },
    ])
  }, [clearShopkeeperSession, router])

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="Settings" showBorder />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <SettingsSection title="My Account">
          <SettingsRow
            icon="person-outline"
            label="Signed in as"
            value={shopkeeperSession?.shopkeeper.fullName ?? 'Staff'}
            description={`@${shopkeeperSession?.shopkeeper.username ?? ''}`}
            showChevron={false}
          />
          <SettingsRow
            icon="receipt-outline"
            label="Receipt suffix"
            value={shopkeeperSession?.shopkeeper.receiptSuffix?.trim() || '—'}
            description="Used on your receipts; owner can change it in Manage Staff"
            showChevron={false}
          />
          <SettingsRow
            icon="business-outline"
            label="Business"
            value={shopkeeperSession?.businessName ?? ''}
            showChevron={false}
          />
          {shopkeeperSession?.shopkeeper.shopLabel ? (
            <SettingsRow
              icon="storefront-outline"
              label="Shop"
              value={shopkeeperSession.shopkeeper.shopLabel}
              showChevron={false}
            />
          ) : null}
          <SettingsRow
            icon="log-out-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Sign Out"
            description="Return to the login screen"
            onPress={handleSignOut}
          />
        </SettingsSection>
        <SettingsSection title="App">
          <SettingsRow
            icon="information-circle-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="App Version"
            value="1.0.0"
            showChevron={false}
          />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
})
