/**
 * Supabase Auth requires a valid-looking email. Purely numeric local-parts
 * (e.g. 0772773774@…) are often rejected. We use a letter prefix for phone
 * accounts. The auth email is always derived from the phone number — never
 * from the optional display username.
 */
export const AUTH_EMAIL_DOMAIN = 'profitprotector.app' as const

export function buildSupabaseEmailFromPhone(phone10: string): string {
  return `u${phone10}@${AUTH_EMAIL_DOMAIN}`
}

/** Older app versions used the raw phone as the local-part; kept for sign-in fallback. */
export function buildLegacySupabaseEmailFromPhone(phone10: string): string {
  return `${phone10}@${AUTH_EMAIL_DOMAIN}`
}

/** Zimbabwe local 10-digit form (07…) from common input / E.164 variants. */
export function normalizePhone10(raw: string): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10 && d.startsWith('07')) return d
  if (d.length === 9 && d.startsWith('7')) return `0${d}`
  if (d.length === 12 && d.startsWith('263')) return `0${d.slice(3)}`
  if (d.length === 13 && d.startsWith('2630')) return d.slice(3)
  return null
}

/** Recover 07… phone from an Auth user when `app_users` is missing or unreadable. */
export function phone10FromAuthUser(
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null },
  fallback = '',
): string | null {
  const meta = user.user_metadata?.phone_local
  if (typeof meta === 'string') {
    const fromMeta = normalizePhone10(meta)
    if (fromMeta) return fromMeta
  }
  const email = user.email ?? ''
  const prefixed = email.match(/^u(07\d{8})@/i)
  if (prefixed) return prefixed[1]
  const legacy = email.match(/^(07\d{8})@/)
  if (legacy) return legacy[1]
  return normalizePhone10(fallback)
}

/** Empty string, or lowercase 3–30 chars, letter first, [a-z0-9_]. */
export const LOGIN_USERNAME_REGEX = /^[a-z][a-z0-9_]{2,29}$/

export function normalizeOptionalLoginUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidOptionalLoginUsername(normalized: string): boolean {
  return normalized === '' || LOGIN_USERNAME_REGEX.test(normalized)
}

export type ParsedLoginIdentifier =
  | { kind: 'phone'; email: string; legacyEmail?: string }
  | { kind: 'username'; username: string }
  | { kind: 'invalid'; message: string }

/**
 * Parse login identifier: digits → phone-based synthetic email; otherwise → username
 * (username must be resolved to email via RPC using `businesses.login_username`).
 */
export function parseLoginIdentifier(raw: string): ParsedLoginIdentifier {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { kind: 'invalid', message: 'Enter your phone number or username' }
  }

  const looksLikePhone = /^[\d\s+]+$/.test(trimmed)
  if (looksLikePhone) {
    const phone = normalizePhone10(trimmed)
    if (phone) {
      const email = buildSupabaseEmailFromPhone(phone)
      const legacy = buildLegacySupabaseEmailFromPhone(phone)
      return {
        kind: 'phone',
        email,
        legacyEmail: legacy === email ? undefined : legacy,
      }
    }
    return { kind: 'invalid', message: 'Phone must be 10 digits starting with 07' }
  }

  const u = normalizeOptionalLoginUsername(trimmed).replace(/\s/g, '')
  if (!LOGIN_USERNAME_REGEX.test(u)) {
    return {
      kind: 'invalid',
      message:
        'Username must be 3–30 characters, start with a letter, and use only letters, numbers, or underscores',
    }
  }
  return { kind: 'username', username: u }
}
