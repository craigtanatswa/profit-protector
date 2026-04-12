import type { SupabaseClient } from '@supabase/supabase-js'

import { parseLoginIdentifier } from './authIdentity'

export type ResolvedSignInEmail =
  | { ok: true; email: string; legacyEmail?: string }
  | { ok: false; message: string }

/**
 * Resolves the email used for `signInWithPassword`.
 * Phone → synthetic email from digits. Username → RPC maps to the account’s phone-based email.
 */
export async function resolveEmailForSignIn(
  supabase: SupabaseClient,
  identifierRaw: string,
): Promise<ResolvedSignInEmail> {
  const parsed = parseLoginIdentifier(identifierRaw)
  if (parsed.kind === 'invalid') {
    return { ok: false, message: parsed.message }
  }
  if (parsed.kind === 'phone') {
    return { ok: true, email: parsed.email, legacyEmail: parsed.legacyEmail }
  }

  const { data, error } = await supabase.rpc('auth_email_for_login_username', {
    p_username: parsed.username,
  })

  if (error) {
    return {
      ok: false,
      message: error.message ?? 'Could not look up this username. Try your phone number.',
    }
  }

  const email = typeof data === 'string' ? data.trim() : ''
  if (!email) {
    return { ok: false, message: 'No account found for this username.' }
  }

  return { ok: true, email }
}
