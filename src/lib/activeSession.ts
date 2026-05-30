import * as SecureStore from 'expo-secure-store'

import { getDeviceId, getDeviceName } from './deviceId'
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'

const OWNER_SESSION_ID_KEY = 'pp_owner_active_session_id'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/active-session`

export const SESSION_SUPERSEDED_MESSAGE = 'Signed in on another device. Please log in again.'

export function isSessionSupersededResponse(data: Record<string, unknown>): boolean {
  return data.status === 'session_superseded'
}

export async function getOwnerActiveSessionId(): Promise<string | null> {
  return SecureStore.getItemAsync(OWNER_SESSION_ID_KEY)
}

export async function setOwnerActiveSessionId(sessionId: string): Promise<void> {
  await SecureStore.setItemAsync(OWNER_SESSION_ID_KEY, sessionId)
}

export async function clearOwnerActiveSessionId(): Promise<void> {
  await SecureStore.deleteItemAsync(OWNER_SESSION_ID_KEY).catch(() => {})
}

async function callActiveSession(body: object): Promise<Record<string, unknown>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('No owner session')
  }

  const resp = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })

  const text = await resp.text()
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(text.trim().slice(0, 200) || `Active session request failed (${resp.status})`)
  }
}

/**
 * Claims this device as the owner's only active session (fresh sign-in).
 * Revokes Supabase refresh tokens on other devices and stores session_id locally.
 */
export async function registerOwnerActiveSession(): Promise<string | null> {
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {})

  const deviceId = await getDeviceId()
  const deviceName = await getDeviceName()

  const data = await callActiveSession({
    action: 'register',
    deviceId,
    deviceName,
  })

  if (data.ok !== true || typeof data.sessionId !== 'string') {
    console.warn('[activeSession] register failed:', data.error ?? data)
    return null
  }

  await setOwnerActiveSessionId(data.sessionId)
  return data.sessionId
}

/**
 * Restores the local session_id when missing (e.g. after app upgrade).
 * Returns superseded when another device holds the active session.
 */
async function syncOwnerActiveSession(): Promise<'valid' | 'superseded' | 'unavailable'> {
  try {
    const deviceId = await getDeviceId()
    const deviceName = await getDeviceName()
    const data = await callActiveSession({ action: 'sync', deviceId, deviceName })

    if (data.ok === true && typeof data.sessionId === 'string') {
      await setOwnerActiveSessionId(data.sessionId)
      return 'valid'
    }
    if (data.reason === 'superseded') return 'superseded'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Ensures the locally stored session_id still matches the server.
 * Returns 'valid', 'superseded', or 'unavailable' (network/server error — do not logout).
 */
export async function validateOwnerActiveSession(): Promise<'valid' | 'superseded' | 'unavailable'> {
  const sessionId = await getOwnerActiveSessionId()
  if (!sessionId) return syncOwnerActiveSession()

  try {
    const data = await callActiveSession({ action: 'validate', sessionId })
    if (data.ok === true) return 'valid'
    if (data.reason === 'superseded' || data.reason === 'missing_session') return 'superseded'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Validate on resume; sync by device when local session_id is missing.
 */
export async function ensureOwnerActiveSession(): Promise<'valid' | 'superseded' | 'unavailable'> {
  return validateOwnerActiveSession()
}
