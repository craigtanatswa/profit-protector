import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import * as Device from 'expo-device'

import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'

const EAS_PROJECT_ID = (
  Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
)?.eas?.projectId

/** Cached after first read; cleared on logout. */
let cachedExpoPushToken: string | null | undefined

export async function getCurrentExpoPushTokenAsync(): Promise<string | null> {
  if (cachedExpoPushToken !== undefined) return cachedExpoPushToken
  if (!Device.isDevice || !EAS_PROJECT_ID) {
    cachedExpoPushToken = null
    return null
  }
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') {
    cachedExpoPushToken = null
    return null
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    })
    cachedExpoPushToken = data ?? null
    return cachedExpoPushToken
  } catch {
    cachedExpoPushToken = null
    return null
  }
}

export function clearExpoPushTokenCache() {
  cachedExpoPushToken = undefined
}

/**
 * Registers this device's Expo push token for the signed-in owner so low-stock
 * alerts can be delivered when the app is not running (requires Edge Function + RPC).
 */
export async function syncOwnerExpoPushTokenToSupabase(): Promise<void> {
  const { isAuthenticated, activeRole } = useAuthStore.getState()
  if (!isAuthenticated || activeRole !== 'owner') return

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) return

  if (!Device.isDevice || !EAS_PROJECT_ID) return

  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return

  const token = await getCurrentExpoPushTokenAsync()
  if (!token) return

  const { error } = await supabase.from('owner_expo_push_tokens').upsert(
    {
      user_id: session.user.id,
      expo_push_token: token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_push_token' },
  )

  if (error && __DEV__) {
    console.warn('[expoPush] token upsert:', error.message)
  }
}

/** Remove all push tokens for the current user (call before sign-out). */
export async function removeOwnerExpoPushTokensFromSupabase(): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) return

  await supabase.from('owner_expo_push_tokens').delete().eq('user_id', session.user.id)
  clearExpoPushTokenCache()
}

function stringifyData(
  data: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v != null) out[k] = v
  }
  return out
}

async function invokeOwnerPush(params: {
  businessId: string
  title: string
  body: string
  data?: Record<string, string>
  androidChannel?: string
  excludeToken?: string | null
}): Promise<void> {
  const { error } = await supabase.functions.invoke('send-owner-push', {
    body: {
      business_id: params.businessId,
      title: params.title,
      body: params.body,
      data: params.data ?? {},
      android_channel: params.androidChannel,
      exclude_expo_push_token: params.excludeToken ?? null,
    },
  })
  if (error && __DEV__) {
    console.warn('[expoPush] send-owner-push:', error.message)
  }
}

/**
 * Fan-out low-stock alert to the owner's registered devices via Expo Push.
 * The current device's token is excluded to avoid doubling up with the local notification.
 * Only fires when the signed-in user is the owner.
 */
export async function requestLowStockRemotePushIfOwner(params: {
  businessId: string
  productId?: string
  title: string
  body: string
  data: Record<string, string | undefined>
}): Promise<void> {
  const { isAuthenticated, activeRole } = useAuthStore.getState()
  if (!isAuthenticated || activeRole !== 'owner') return

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return

  const exclude = await getCurrentExpoPushTokenAsync()

  await invokeOwnerPush({
    businessId: params.businessId,
    title: params.title,
    body: params.body,
    data: stringifyData(params.data),
    androidChannel: (params.data.type ?? '') === 'out_of_stock' ? 'out-of-stock' : 'low-stock',
    excludeToken: exclude,
  })
}

/**
 * Fan-out staff-sale alert to the owner's **other** registered devices via Expo Push.
 * The current device already shows the local notification / in-app banner, so we exclude it.
 * Only fires when the signed-in user is the owner.
 */
export async function requestStaffSaleRemotePushIfOwner(params: {
  businessId: string
  title: string
  body: string
}): Promise<void> {
  const { isAuthenticated, activeRole } = useAuthStore.getState()
  if (!isAuthenticated || activeRole !== 'owner') return

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return

  const exclude = await getCurrentExpoPushTokenAsync()

  await invokeOwnerPush({
    businessId: params.businessId,
    title: params.title,
    body: params.body,
    data: { type: 'staff_sale', screen: 'sales' },
    androidChannel: 'staff-sales',
    excludeToken: exclude,
  })
}
