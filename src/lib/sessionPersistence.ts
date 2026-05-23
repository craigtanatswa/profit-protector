import * as SecureStore from 'expo-secure-store'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

import { supabase } from './supabase'

/** Users must sign in again after this duration. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

const OWNER_LOGIN_AT_KEY = 'pp_owner_session_login_at'
const SHOPKEEPER_LOGIN_AT_KEY = 'pp_sk_sess_signed_in_at'

export function isSessionLoginExpired(loginAtMs: number | null, now = Date.now()): boolean {
  if (loginAtMs == null) return false
  return now - loginAtMs >= SESSION_MAX_AGE_MS
}

export async function recordOwnerSessionLogin(atMs: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(OWNER_LOGIN_AT_KEY, String(atMs))
}

export async function getOwnerSessionLoginAt(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(OWNER_LOGIN_AT_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function clearOwnerSessionLogin(): Promise<void> {
  await SecureStore.deleteItemAsync(OWNER_LOGIN_AT_KEY).catch(() => {})
}

/** Backfill login time for sessions restored before this feature shipped. */
export async function ensureOwnerSessionLoginTimestamp(user: User): Promise<void> {
  const existing = await getOwnerSessionLoginAt()
  if (existing != null) return

  const fromUser = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN
  await recordOwnerSessionLogin(Number.isFinite(fromUser) ? fromUser : Date.now())
}

export async function isOwnerSessionExpired(): Promise<boolean> {
  return isSessionLoginExpired(await getOwnerSessionLoginAt())
}

export async function recordShopkeeperSessionLogin(atMs: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(SHOPKEEPER_LOGIN_AT_KEY, String(atMs))
}

export async function getShopkeeperSessionLoginAt(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(SHOPKEEPER_LOGIN_AT_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function clearShopkeeperSessionLogin(): Promise<void> {
  await SecureStore.deleteItemAsync(SHOPKEEPER_LOGIN_AT_KEY).catch(() => {})
}

export async function isShopkeeperSessionExpired(): Promise<boolean> {
  return isSessionLoginExpired(await getShopkeeperSessionLoginAt())
}

/** Backfill login time from the shopkeeper JWT for sessions stored before this feature. */
export async function ensureShopkeeperSessionLoginTimestamp(sessionToken: string): Promise<void> {
  const existing = await getShopkeeperSessionLoginAt()
  if (existing != null) return

  try {
    const parts = sessionToken.split('.')
    if (parts.length >= 2) {
      const payload = JSON.parse(atob(parts[1])) as { iat?: number }
      if (typeof payload.iat === 'number' && Number.isFinite(payload.iat)) {
        await recordShopkeeperSessionLogin(payload.iat)
        return
      }
    }
  } catch {
    /* fall through */
  }

  await recordShopkeeperSessionLogin()
}

/**
 * Enforce the 24-hour owner session window. Returns false when the session was
 * expired and cleared.
 */
export async function enforceOwnerSessionMaxAge(session: Session | null): Promise<boolean> {
  if (!session?.user) return false

  if (session.user) {
    await ensureOwnerSessionLoginTimestamp(session.user)
  }

  if (!(await isOwnerSessionExpired())) return true

  await clearOwnerSessionLogin()
  try {
    await supabase.auth.signOut()
  } catch {
    /* session may already be invalid */
  }
  return false
}

/** Track fresh sign-ins and re-check expiry when Supabase refreshes tokens. */
export async function handleOwnerAuthStateChange(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<Session | null> {
  if (!session?.user) return session

  if (event === 'SIGNED_IN') {
    await recordOwnerSessionLogin()
    return session
  }

  const valid = await enforceOwnerSessionMaxAge(session)
  return valid ? session : null
}
