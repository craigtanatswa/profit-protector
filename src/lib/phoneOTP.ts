import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'

export type PhoneOtpSendResult = {
  success: boolean
  error?: string
}

export type PhoneOtpVerifySignupResult = {
  success: boolean
  error?: string
  signupComplete?: boolean
}

/**
 * Send OTP via Prelude (Edge Function → Prelude Verify API).
 */
export async function sendPhoneOtp(phone: string): Promise<PhoneOtpSendResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ phone: phone.trim() }),
  })

  const text = await response.text()
  let data: { error?: string; success?: boolean } = {}
  try {
    if (text) data = JSON.parse(text) as typeof data
  } catch {
    if (!response.ok) {
      return {
        success: false,
        error: text.trim().slice(0, 200) || `Request failed (${response.status})`,
      }
    }
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok) {
    return {
      success: false,
      error: data.error ?? `Failed to send code (${response.status})`,
    }
  }
  return { success: true }
}

/**
 * Signup: verify Prelude code + create Supabase Auth user (server-side).
 * Call `signInWithPassword` immediately after success.
 */
export async function verifySignupOtp(
  phone: string,
  code: string,
  password: string,
): Promise<PhoneOtpVerifySignupResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      phone: phone.trim(),
      code: code.trim(),
      password,
    }),
  })

  const text = await response.text()
  let raw: { success?: boolean; error?: string; signupComplete?: boolean } = {}
  try {
    if (text) raw = JSON.parse(text) as typeof raw
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok || raw.success !== true) {
    return {
      success: false,
      error: raw.error ?? 'Verification failed.',
    }
  }

  return { success: true, signupComplete: raw.signupComplete === true }
}

/**
 * Logged-in user: verify phone with Prelude (no password; updates Auth phone).
 */
export async function verifyPhoneOtpForSession(phone: string, code: string): Promise<{
  success: boolean
  error?: string
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  }
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      phone: phone.trim(),
      code: code.trim(),
    }),
  })

  const text = await response.text()
  let raw: { success?: boolean; error?: string } = {}
  try {
    if (text) raw = JSON.parse(text) as typeof raw
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok || raw.success !== true) {
    return { success: false, error: raw.error ?? 'Verification failed.' }
  }
  return { success: true }
}
