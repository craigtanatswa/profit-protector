/** Minimal JWT payload decode for Edge (no verification — Gateway already validated user JWT). */

export type JwtPayload = {
  sub?: string
  role?: string
  aud?: string | string[]
}

function audienceIsAuthenticated(aud: string | string[] | undefined): boolean {
  if (aud === 'authenticated') return true
  if (Array.isArray(aud) && aud.includes('authenticated')) return true
  return false
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = base64.length % 4
    if (pad) base64 += '='.repeat(4 - pad)
    const json = atob(base64)
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

/** True when token looks like a logged-in Supabase user JWT (not the anon publishable key JWT). */
export function isAuthenticatedUserJwt(payload: JwtPayload | null): payload is JwtPayload & {
  sub: string
} {
  return Boolean(
    payload?.sub &&
      (payload.role === 'authenticated' || audienceIsAuthenticated(payload.aud)),
  )
}
