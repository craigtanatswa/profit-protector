/**
 * SHA-512 using the Web Crypto API (available in Deno / Edge Functions).
 * Returns an uppercase hex string.
 */
export async function sha512(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hash = await crypto.subtle.digest('SHA-512', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Build a Paynow outbound hash by concatenating field values in the given
 * key order, then appending the integration key. Only keys present in `fields`
 * are included — this keeps the hash aligned with the actual POST body.
 */
export async function paynowOutboundHash(
  fields: Record<string, string>,
  fieldOrder: string[],
  integrationKey: string,
): Promise<string> {
  let payload = ''
  for (const key of fieldOrder) {
    if (key in fields && key !== 'hash') {
      payload += fields[key]
    }
  }
  payload += integrationKey
  return sha512(payload)
}
