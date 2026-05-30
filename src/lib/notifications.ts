/*
 * Low-stock alerts: local notifications (when JS runs) plus Expo Push via
 * `low-stock-expo-push` Edge Function so owners can be reached when the app is killed.
 * Register tokens in `owner_expo_push_tokens` (see expoPushRemote.ts).
 * Optional: database trigger → Edge Function with x-low-stock-internal-secret for staff-only devices.
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { AppState, Platform } from 'react-native'

import { database } from '../database'
import { Q } from '@nozbe/watermelondb'
import type ProductModel from '../database/models/Product'
import WMBusiness from '../database/models/Business'
import { getPersonalisation, normalizeBusinessType } from './appPersonalisation'
import { shouldScheduleOsLocalBusinessAlerts } from './notificationDeliveryMode'
import { requestLowStockRemotePushIfOwner } from './expoPushRemote'

// ---------------------------------------------------------------------------
// Android notification channels
// ---------------------------------------------------------------------------

export type InAppBizNotificationPayload = {
  title: string
  body: string
  data: Record<string, string | undefined>
}

let inAppBizNotificationSink: ((payload: InAppBizNotificationPayload) => void) | null = null

/** Register the tab shell handler for in-session alerts; clear on unmount. */
export function registerInAppBizNotificationSink(
  handler: ((payload: InAppBizNotificationPayload) => void) | null,
) {
  inAppBizNotificationSink = handler
}

function normalizeNotificationData(
  data: Record<string, unknown> | undefined,
): Record<string, string | undefined> {
  if (data == null || typeof data !== 'object') return {}
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = v == null ? undefined : String(v)
  }
  return out
}

function isLowStockNotificationData(
  data: Record<string, unknown> | undefined,
): boolean {
  const t = data?.type
  return t === 'low_stock' || t === 'out_of_stock' || t === 'multi_low_stock'
}

async function deliverBizLocalNotification(params: {
  identifier?: string
  content: Notifications.NotificationContentInput
  /**
   * Low-stock alerts always use scheduled locals so the owner is notified outside the app
   * (background/closed), including right after a sale taps stock under threshold.
   */
  alwaysScheduleOs?: boolean
}): Promise<void> {
  const title =
    typeof params.content.title === 'string' ? params.content.title : ''
  const body = typeof params.content.body === 'string' ? params.content.body : ''
  const data = normalizeNotificationData(
    params.content.data as Record<string, unknown> | undefined,
  )

  const useOs =
    params.alwaysScheduleOs || shouldScheduleOsLocalBusinessAlerts()

  if (useOs) {
    await Notifications.scheduleNotificationAsync({
      content: params.content,
      trigger: null,
      ...(params.identifier != null ? { identifier: params.identifier } : {}),
    })
    return
  }

  if (inAppBizNotificationSink) {
    inAppBizNotificationSink({ title, body, data })
  } else if (__DEV__) {
    console.warn(
      '[notifications] In-app-only mode but no sink registered; alert dropped',
    )
  }
}

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

  await Notifications.setNotificationChannelAsync('staff-inventory', {
    name: 'Staff inventory',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#B45309',
    sound: 'default',
    description: 'When a shopkeeper adjusts stock levels',
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
  businessId: string
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

  const title = isOutOfStock ? '🚨 Out of Stock!' : '⚠️ Low Stock Alert'
  const bodyText = isOutOfStock
    ? `${prefix} — ${params.productName} is out of stock. Tap to reorder now.`
    : `${prefix} — ${params.productName} has only ${params.currentStock} ${params.unit} left (threshold: ${params.threshold}). Time to reorder!`
  const dataFields = {
    productId: params.productId,
    type: isOutOfStock ? 'out_of_stock' : 'low_stock',
    screen: 'product_detail',
  } as const

  await deliverBizLocalNotification({
    alwaysScheduleOs: true,
    identifier: `stock-${params.productId}`,
    content: {
      title,
      body: bodyText,
      data: {
        ...dataFields,
      },
      sound: 'default',
      priority: isOutOfStock
        ? Notifications.AndroidNotificationPriority.MAX
        : Notifications.AndroidNotificationPriority.HIGH,
      color: isOutOfStock ? '#C0152A' : '#B45309',
      ...(Platform.OS === 'android'
        ? { channelId: isOutOfStock ? 'out-of-stock' : 'low-stock' }
        : {}),
    },
  })

  void requestLowStockRemotePushIfOwner({
    businessId: params.businessId,
    productId: params.productId,
    title,
    body: bodyText,
    data: {
      productId: params.productId,
      type: dataFields.type,
      screen: dataFields.screen,
    },
  })
}

/** In-app banner when the owner app receives a staff sale via Realtime (push is server-side). */
export async function notifyOwnerStaffSale(params: {
  businessId: string
  receiptNumber: string
  staffLabel: string
  totalLabel?: string
}): Promise<void> {
  await setupAndroidChannels()

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const receipt = params.receiptNumber.trim() || 'Sale'
  const totalPart = params.totalLabel ? ` · ${params.totalLabel}` : ''
  const title = '🛒 Staff Sale Recorded'
  const body = `${params.staffLabel} completed ${receipt}${totalPart}`

  await deliverBizLocalNotification({
    content: {
      title,
      body,
      data: {
        type: 'staff_sale',
        screen: 'sales',
      },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: '#0047AB',
      ...(Platform.OS === 'android' ? { channelId: 'staff-sales' } : {}),
    },
  })
}

/** In-app banner when the owner app receives a staff stock adjustment via Realtime. */
export async function notifyOwnerStaffStockAdjustment(params: {
  businessId: string
  staffLabel: string
  productName: string
  qtyChange: number
  unit?: string
}): Promise<void> {
  await setupAndroidChannels()

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const unit = params.unit?.trim() || 'units'
  const qtyLabel =
    params.qtyChange > 0
      ? `+${params.qtyChange} ${unit}`
      : params.qtyChange < 0
        ? `−${Math.abs(params.qtyChange)} ${unit}`
        : `0 ${unit}`
  const title =
    params.qtyChange >= 0 ? '📦 Staff Stock Added' : '📦 Staff Stock Removed'
  const body = `${params.staffLabel} adjusted ${params.productName} (${qtyLabel})`

  await deliverBizLocalNotification({
    content: {
      title,
      body,
      data: {
        type: 'staff_stock_adjustment',
        screen: 'activity_log',
      },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: params.qtyChange >= 0 ? '#0A7A4B' : '#C0152A',
      ...(Platform.OS === 'android' ? { channelId: 'staff-inventory' } : {}),
    },
  })
}

/** In-app banner when the owner app receives a staff stock receive via Realtime. */
export async function notifyOwnerStaffStockReceived(params: {
  businessId: string
  staffLabel: string
  productName: string
  qty: number
  unit?: string
}): Promise<void> {
  await setupAndroidChannels()

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const unit = params.unit?.trim() || 'units'
  const qtyLabel = `+${params.qty} ${unit}`
  const title = '📦 Staff Stock Received'
  const body = `${params.staffLabel} received ${qtyLabel} of ${params.productName}`

  await deliverBizLocalNotification({
    content: {
      title,
      body,
      data: {
        type: 'staff_stock_received',
        screen: 'activity_log',
      },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: '#0A7A4B',
      ...(Platform.OS === 'android' ? { channelId: 'staff-inventory' } : {}),
    },
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
      businessId,
      productId: product.id,
      productName: product.name,
      currentStock: product.stockQty,
      threshold: product.lowStockThreshold,
      unit: product.unit,
      messagePrefix,
    })
  }

  if (lowStock.length > 5) {
    const multiTitle = '⚠️ Multiple Low Stock Items'
    const multiBody =
      messagePrefix != null
        ? `${messagePrefix} — ${lowStock.length} products need restocking. Tap to view your inventory.`
        : `${lowStock.length} products need restocking. Tap to view your inventory.`

    await deliverBizLocalNotification({
      alwaysScheduleOs: true,
      identifier: 'multi-low-stock',
      content: {
        title: multiTitle,
        body: multiBody,
        data: {
          type: 'multi_low_stock',
          screen: 'inventory',
        },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'low-stock' } : {}),
      },
    })

    void requestLowStockRemotePushIfOwner({
      businessId,
      title: multiTitle,
      body: multiBody,
      data: {
        type: 'multi_low_stock',
        screen: 'inventory',
      },
    })
  }

  await markLowStockDigestSentToday(businessId)
}

// ---------------------------------------------------------------------------
// Notification handlers — call from app/(app)/_layout.tsx
// ---------------------------------------------------------------------------

function shouldShowStaffSaleOsAlert(
  data: Record<string, unknown> | undefined,
): boolean {
  if (data?.type !== 'staff_sale') return shouldScheduleOsLocalBusinessAlerts()
  // Foreground: Realtime shows the in-app banner; suppress duplicate OS alert from server push.
  return AppState.currentState !== 'active'
}

function shouldShowStaffStockAdjustmentOsAlert(
  data: Record<string, unknown> | undefined,
): boolean {
  if (data?.type !== 'staff_stock_adjustment') return shouldScheduleOsLocalBusinessAlerts()
  return AppState.currentState !== 'active'
}

function shouldShowStaffStockReceivedOsAlert(
  data: Record<string, unknown> | undefined,
): boolean {
  if (data?.type !== 'staff_stock_received') return shouldScheduleOsLocalBusinessAlerts()
  return AppState.currentState !== 'active'
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const raw = notification.request.content
      .data as Record<string, unknown> | undefined
    const showOs =
      isLowStockNotificationData(raw) ||
      shouldShowStaffSaleOsAlert(raw) ||
      shouldShowStaffStockAdjustmentOsAlert(raw) ||
      shouldShowStaffStockReceivedOsAlert(raw)
    return {
      shouldShowAlert: showOs,
      shouldPlaySound: showOs,
      shouldSetBadge: false,
      shouldShowBanner: showOs,
      shouldShowList: showOs,
    }
  },
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
      } else if (data.screen === 'activity_log') {
        router.push('/(app)/settings/activity-log')
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
