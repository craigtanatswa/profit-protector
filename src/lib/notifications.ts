/*
 * TODO — Background Push Notifications (Post-MVP):
 *
 * Current implementation sends LOCAL notifications only.
 * These work when the app is open or in the background
 * but NOT when the app is completely closed.
 *
 * For closed-app notifications:
 * 1. Get Expo push token:
 *    const token = await Notifications.getExpoPushTokenAsync()
 * 2. Store token in Supabase against the business record
 * 3. Set up a Supabase Edge Function or cron job that
 *    checks stock levels daily and sends push notifications
 *    via Expo's push API: https://exp.host/--/api/v2/push/send
 *
 * This is sufficient for MVP — users will see alerts
 * on the owner's first digest of the local day (startup or resume after a calendar-day change),
 * plus per-product alerts when a sale line drives stock at or below threshold.
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { Platform } from 'react-native'

import { database } from '../database'
import { Q } from '@nozbe/watermelondb'
import type ProductModel from '../database/models/Product'
import WMBusiness from '../database/models/Business'
import { getPersonalisation, normalizeBusinessType } from './appPersonalisation'

// ---------------------------------------------------------------------------
// Android notification channels
// ---------------------------------------------------------------------------

export async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return

  await Notifications.setNotificationChannelAsync('low-stock', {
    name: 'Low Stock Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0047AB',
    sound: 'default',
    description: 'Alerts when products are running low',
  })

  await Notifications.setNotificationChannelAsync('out-of-stock', {
    name: 'Out of Stock Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
    lightColor: '#C0152A',
    sound: 'default',
    description: 'Alerts when products are out of stock',
  })

  await Notifications.setNotificationChannelAsync('staff-sales', {
    name: 'Staff sales',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#0047AB',
    sound: 'default',
    description: 'When a shopkeeper records a sale',
  })
}

// ---------------------------------------------------------------------------
// Request permissions
// ---------------------------------------------------------------------------

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) return false

  await setupAndroidChannels()

  const { status: existing } = await Notifications.getPermissionsAsync()

  if (existing === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

// ---------------------------------------------------------------------------
// Send low stock notification for a single product
// ---------------------------------------------------------------------------

export async function sendLowStockNotification(params: {
  productId: string
  productName: string
  currentStock: number
  threshold: number
  unit: string
  /** Overrides generic intro copy when provided */
  messagePrefix?: string
}): Promise<void> {
  const enabled = await SecureStore.getItemAsync('setting_low_stock_alerts')
  if (enabled === 'false') return

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const isOutOfStock = params.currentStock === 0
  const prefix =
    params.messagePrefix ??
    (isOutOfStock ? 'Out of stock' : 'Low stock')

  await Notifications.scheduleNotificationAsync({
    content: {
      title: isOutOfStock ? '🚨 Out of Stock!' : '⚠️ Low Stock Alert',
      body: isOutOfStock
        ? `${prefix} — ${params.productName} is out of stock. Tap to reorder now.`
        : `${prefix} — ${params.productName} has only ${params.currentStock} ${params.unit} left (threshold: ${params.threshold}). Time to reorder!`,
      data: {
        productId: params.productId,
        type: isOutOfStock ? 'out_of_stock' : 'low_stock',
        screen: 'product_detail',
      },
      sound: 'default',
      priority: isOutOfStock
        ? Notifications.AndroidNotificationPriority.MAX
        : Notifications.AndroidNotificationPriority.HIGH,
      color: isOutOfStock ? '#C0152A' : '#B45309',
    },
    trigger: null,
    identifier: `stock-${params.productId}`,
  })
}

/** Local notification for the business owner when staff completes a sale (foreground / background). */
export async function notifyOwnerStaffSale(params: {
  receiptNumber: string
  staffLabel: string
  totalLabel?: string
}): Promise<void> {
  await setupAndroidChannels()

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const receipt = params.receiptNumber.trim() || 'Sale'
  const totalPart = params.totalLabel ? ` · ${params.totalLabel}` : ''

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Staff sale recorded',
      body: `${params.staffLabel} completed ${receipt}${totalPart}`,
      data: {
        type: 'staff_sale',
        screen: 'sales',
      },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: '#0047AB',
      ...(Platform.OS === 'android' ? { channelId: 'staff-sales' } : {}),
    },
    trigger: null,
  })
}

// ---------------------------------------------------------------------------
// Batch low stock digest — once per local calendar day per business (owners)
// ---------------------------------------------------------------------------

function localCalendarDayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function lowStockDigestAlreadySentToday(businessId: string): Promise<boolean> {
  const key = `low_stock_digest_day_${businessId}`
  const last = await SecureStore.getItemAsync(key)
  return last === localCalendarDayKey()
}

async function markLowStockDigestSentToday(businessId: string): Promise<void> {
  const key = `low_stock_digest_day_${businessId}`
  await SecureStore.setItemAsync(key, localCalendarDayKey())
}

/**
 * Sends a digest of currently low/out-of-stock products at most once per local day per business,
 * while `sendLowStockNotification` still fires per line item when a sale completes.
 */
export async function checkAndNotifyLowStock(businessId: string): Promise<void> {
  const enabled = await SecureStore.getItemAsync('setting_low_stock_alerts')
  if (enabled === 'false') return

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  if (await lowStockDigestAlreadySentToday(businessId)) return

  if (!database) return

  let messagePrefix: string | undefined
  try {
    const biz = await database.get<WMBusiness>('businesses').find(businessId)
    messagePrefix = getPersonalisation(normalizeBusinessType(biz.businessType)).lowStockMessage
  } catch {
    messagePrefix = undefined
  }

  const allProducts = await database
    .get<ProductModel>('products')
    .query(
      Q.where('business_id', businessId),
      Q.where('is_active', true),
    )
    .fetch()

  const lowStock = allProducts.filter(
    (p) => p.lowStockThreshold > 0 && p.stockQty <= p.lowStockThreshold,
  )

  if (lowStock.length === 0) {
    await markLowStockDigestSentToday(businessId)
    return
  }

  const toNotify = lowStock.slice(0, 5)

  for (const product of toNotify) {
    await sendLowStockNotification({
      productId: product.id,
      productName: product.name,
      currentStock: product.stockQty,
      threshold: product.lowStockThreshold,
      unit: product.unit,
      messagePrefix,
    })
  }

  if (lowStock.length > 5) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Multiple Low Stock Items',
        body:
          messagePrefix != null
            ? `${messagePrefix} — ${lowStock.length} products need restocking. Tap to view your inventory.`
            : `${lowStock.length} products need restocking. Tap to view your inventory.`,
        data: {
          type: 'multi_low_stock',
          screen: 'inventory',
        },
        sound: 'default',
      },
      trigger: null,
      identifier: 'multi-low-stock',
    })
  }

  await markLowStockDigestSentToday(businessId)
}

// ---------------------------------------------------------------------------
// Notification handlers — call from app/(app)/_layout.tsx
// ---------------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export function setupNotificationHandlers(): () => void {
  const responseListener = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as Record<string, string>

      if (data.screen === 'product_detail' && data.productId) {
        router.push({
          pathname: '/(app)/inventory/[id]',
          params: { id: data.productId },
        })
      } else if (data.screen === 'inventory') {
        router.push('/(app)/inventory')
      } else if (data.screen === 'sales') {
        router.push('/(app)/sales')
      }
    },
  )

  const notificationListener = Notifications.addNotificationReceivedListener(
    (notification) => {
      const data = notification.request.content.data
      console.log('Notification received in foreground:', data)
    },
  )

  return () => {
    responseListener.remove()
    notificationListener.remove()
  }
}
