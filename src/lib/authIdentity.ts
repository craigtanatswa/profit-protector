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

  const looksLikePhone = /^[\d\s]+$/.test(trimmed)
  if (looksLikePhone) {
    const d = trimmed.replace(/\D/g, '')
    let phone: string | null = null
    if (d.length === 10 && d.startsWith('07')) phone = d
    else if (d.length === 9 && d.startsWith('7')) phone = `0${d}`
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
