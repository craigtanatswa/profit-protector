/** Mirrors src/lib/authIdentity.ts — synthetic email for phone accounts. */

export const AUTH_EMAIL_DOMAIN = 'profitprotector.app' as const

export function buildSupabaseEmailFromPhone(phone10: string): string {
  const p = phone10.trim()
  return `u${p}@${AUTH_EMAIL_DOMAIN}`
}
