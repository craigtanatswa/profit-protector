/** Zimbabwe E.164: +263 + 9 digits (mobile). */

const E164_REGEX = /^\+263[0-9]{9}$/

/**
 * Normalize local 10-digit (07…) or bare 9-digit national numbers to +263….
 * Returns null if invalid.
 */
export function normalizeZimbabwePhone(input: string): string | null {
  const t = input.trim().replace(/\s/g, '')
  if (E164_REGEX.test(t)) return t
  if (/^0[0-9]{9}$/.test(t)) {
    const n = `+263${t.slice(1)}`
    return E164_REGEX.test(n) ? n : null
  }
  if (/^[0-9]{9}$/.test(t)) {
    const n = `+263${t}`
    return E164_REGEX.test(n) ? n : null
  }
  return null
}
