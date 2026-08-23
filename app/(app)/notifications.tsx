import { useEffect, useState, useCallback } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { Q } from '@nozbe/watermelondb'
import { StatusBar } from 'expo-status-bar'

import { useAuthStore } from '../../src/stores/authStore'
import { database } from '../../src/database'
import type ProductModel from '../../src/database/models/Product'
import type { Product } from '../../src/types'
import { normalizeTrackingMode } from '../../src/lib/cutProducts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationItem {
  id: string
  type: 'recovery_email' | 'low_stock' | 'out_of_stock'
  title: string
  message: string
  onPress: () => void
  iconName: keyof typeof Ionicons.glyphMap
  iconColor: string
  iconBg: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapProductRecord(record: ProductModel): Product {
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    category: record.category ?? undefined,
    unit: record.unit,
    trackingMode: normalizeTrackingMode(record.trackingMode),
    costPriceCents: record.costPriceCents,
    sellingPriceCents: record.sellingPriceCents,
    stockQty: record.stockQty,
    lowStockThreshold: record.lowStockThreshold,
    isActive: record.isActive,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.getTime() : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets()
  const { business, activeRole } = useAuthStore()
  const isShopkeeper = activeRole === 'shopkeeper'
  const businessId = business?.id ?? ''
  const recoveryVerified = business?.recoveryEmailVerified === true

  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!database || !businessId) {
      setIsLoading(false)
      return
    }
    try {
      const raw = await database
        .get<ProductModel>('products')
        .query(Q.where('business_id', businessId), Q.where('is_active', true))
        .fetch()
      const mapped = raw.map(mapProductRecord)
      const lowStock = mapped.filter(
        (p) =>
          p.lowStockThreshold != null &&
          p.lowStockThreshold > 0 &&
          p.stockQty <= p.lowStockThreshold,
      )
      setLowStockProducts(lowStock)
    } catch {
      // silently ignore DB errors
    } finally {
      setIsLoading(false)
    }
  }, [businessId])

  useFocusEffect(
    useCallback(() => {
      void loadData()
    }, [loadData]),
  )

  // Save current notification hash when the screen is viewed so the bell stops shaking
  useEffect(() => {
    if (isLoading) return
    const hash = `${lowStockProducts.length}:${recoveryVerified ? '1' : '0'}`
    void SecureStore.setItemAsync('notifications_seen_hash', hash)
  }, [isLoading, lowStockProducts.length, recoveryVerified])

  // Build notification items
  const notifications: NotificationItem[] = []

  if (!isShopkeeper && !recoveryVerified) {
    notifications.push({
      id: 'recovery_email',
      type: 'recovery_email',
      title: 'Secure your account',
      message: 'Add a recovery email to protect your business data in case you lose phone access.',
      iconName: 'shield-outline',
      iconColor: '#B45309',
      iconBg: '#FEF3C7',
      onPress: () => {
        router.push({ pathname: '/(app)/settings', params: { focus: 'security' } })
      },
    })
  }

  for (const product of lowStockProducts) {
    const isOut = product.stockQty <= 0
    notifications.push({
      id: `stock_${product.id}`,
      type: isOut ? 'out_of_stock' : 'low_stock',
      title: isOut ? `Out of stock: ${product.name}` : `Low stock: ${product.name}`,
      message: isOut
        ? `${product.name} has run out. Restock to keep selling.`
        : `Only ${product.stockQty} ${product.unit ?? 'units'} left (threshold: ${product.lowStockThreshold ?? 0}).`,
      iconName: isOut ? 'close-circle-outline' : 'warning-outline',
      iconColor: isOut ? '#C0152A' : '#B45309',
      iconBg: isOut ? '#FCEBEB' : '#FEF3C7',
      onPress: () => {
        router.push({
          pathname: '/(app)/inventory/[id]',
          params: { id: product.id },
        } as never)
      },
    })
  }

  return (
    <>
      <StatusBar style="light" />
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          {notifications.length > 0 ? (
            <View style={styles.badgePill}>
              <Text style={styles.badgePillText}>{notifications.length}</Text>
            </View>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0047AB" />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle" size={56} color="#0A7A4B" />
            <Text style={styles.emptyTitle}>All clear!</Text>
            <Text style={styles.emptyMessage}>
              No notifications right now. You'll see low stock alerts and account reminders here.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {notifications.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.notifCard, index === 0 && styles.notifCardFirst]}
                activeOpacity={0.75}
                onPress={item.onPress}
              >
                <View style={[styles.iconWrap, { backgroundColor: item.iconBg }]}>
                  <Ionicons name={item.iconName} size={22} color={item.iconColor} />
                </View>
                <View style={styles.notifBody}>
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  <Text style={styles.notifMessage}>{item.message}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9AA5B4" />
              </TouchableOpacity>
            ))}
            <View style={styles.bottomPad} />
          </ScrollView>
        )}
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  header: {
    backgroundColor: '#0047AB',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 16,
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  badgePill: {
    backgroundColor: '#C0152A',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  badgePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 24,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0D1B3E',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    lineHeight: 22,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  notifCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    shadowColor: '#0D1B3E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  notifCardFirst: {
    // no extra top margin needed
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  notifBody: {
    flex: 1,
    marginRight: 8,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
    marginBottom: 3,
  },
  notifMessage: {
    fontSize: 13,
    color: '#5A6A8A',
    lineHeight: 19,
  },
  bottomPad: {
    height: 32,
  },
})
