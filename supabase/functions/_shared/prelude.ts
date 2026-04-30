/** Prelude Verify API v2 — https://api.prelude.dev */

const DEFAULT_BASE = 'https://api.prelude.dev'

export type PreludeCreateResult =
  | { ok: true; status: string; raw: Record<string, unknown> }
  | { ok: false; detail: string; raw?: Record<string, unknown> }

export type PreludeCheckResult =
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; detail: string; raw?: Record<string, unknown> }

export function preludeBaseUrl(): string {
  return Deno.env.get('PRELUDE_API_BASE')?.trim() || DEFAULT_BASE
}

export async function preludeCreateVerification(
  e164: string,
  apiKey: string,
): Promise<PreludeCreateResult> {
  const url = `${preludeBaseUrl()}/v2/verification`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target: { type: 'phone_number', value: e164 },
    }),
  })

  let raw: Record<string, unknown> = {}
  try {
    raw = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, detail: 'Invalid Prelude response' }
  }

  const status = typeof raw.status === 'string' ? raw.status : ''
  if (!res.ok) {
    const msg =
      typeof raw.message === 'string'
        ? raw.message
        : `Prelude send failed (${res.status})`
    return { ok: false, detail: msg, raw }
  }

  if (status === 'blocked') {
    const reason = typeof raw.reason === 'string' ? raw.reason : 'blocked'
    return { ok: false, detail: `Prelude blocked: ${reason}`, raw }
  }

  if (status !== 'success' && status !== 'retry') {
    return {
      ok: false,
      detail: status ? `Prelude status: ${status}` : 'Could not send verification',
      raw,
    }
  }

  return { ok: true, status, raw }
}

export async function preludeCheckVerificationCode(
  e164: string,
  code: string,
  apiKey: string,
): Promise<PreludeCheckResult> {
  const url = `${preludeBaseUrl()}/v2/verification/check`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target: { type: 'phone_number', value: e164 },
      code: code.trim(),
    }),
  })

  let raw: Record<string, unknown> = {}
  try {
    raw = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, detail: 'Invalid Prelude response' }
  }

  const st = typeof raw.status === 'string' ? raw.status : ''

  if (!res.ok) {
    const msg =
      typeof raw.message === 'string'
        ? raw.message
        : `Prelude verify failed (${res.status})`
    return { ok: false, detail: msg, raw }
  }

  if (st !== 'success') {
    const detail =
      st === 'failure'
        ? 'Invalid verification code.'
        : st === 'expired_or_not_found'
          ? 'Code expired or not found. Request a new code.'
          : `Verification failed (${st || 'unknown'})`
    return { ok: false, detail, raw }
  }

  return { ok: true, raw }
}
