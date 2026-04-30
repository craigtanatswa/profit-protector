const ITERATIONS = 100_000
const HASH_BITS = 256
const PREFIX = 'pbkdf2-sha256'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const n = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(n)) return null
    out[i] = n
  }
  return out
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]
  return x === 0
}

export function generateSixDigitOtp(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const n = 100000 + (buf[0] % 900000)
  return String(n).padStart(6, '0')
}

export async function hashOtp(otp: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(otp),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  )
  const hash = new Uint8Array(bits)
  return `${PREFIX}$${ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`
}

export async function verifyOtpAgainstHash(otp: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) return false
  const iterations = parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < 1000) return false
  const salt = hexToBytes(parts[2])
  const expected = hexToBytes(parts[3])
  if (!salt || !expected || expected.length * 8 !== HASH_BITS) return false

  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(otp),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  )
  const derived = new Uint8Array(bits)
  return timingSafeEqualBytes(derived, expected)
}
