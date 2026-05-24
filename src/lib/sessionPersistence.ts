import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import { clearOwnerActiveSessionId, registerOwnerActiveSession } from './activeSession'

/**
 * Called on every Supabase auth state change.
 * - SIGNED_IN  → register this device as the active session (revokes others).
 * - SIGNED_OUT → clear the stored active-session id.
 * - Anything else (TOKEN_REFRESHED, etc.) → pass through unchanged; no
 *   time-based expiry is enforced — sessions live until the user manually
 *   signs out, their credentials change, or another device signs in.
 */
export async function handleOwnerAuthStateChange(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<Session | null> {
  if (event === 'SIGNED_OUT' || !session?.user) {
    await clearOwnerActiveSessionId()
    return session
  }

  if (event === 'SIGNED_IN') {
    try {
      await registerOwnerActiveSession()
    } catch (err) {
      console.warn('[sessionPersistence] registerOwnerActiveSession:', err)
    }
  }

  return session
}
