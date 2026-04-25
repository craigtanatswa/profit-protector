import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'

// TODO(optional): Pass the logged-in user's access token in the Edge Function `Authorization`
// header instead of the anon key so `send-otp-email` can verify `userId` against `sub`.

export type EmailOtpPurpose = 'add_email' | 'change_password' | 'recovery'

/**
 * Send a 6-digit code via Resend (Edge Function). Requires a logged-in user.
 */
export async function sendEmailOTP(
  email: string,
  purpose: EmailOtpPurpose,
): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim()
  if (!trimmed) {
    return { success: false, error: 'Email is required' }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-otp-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email: trimmed, userId, purpose }),
  })

  let data: { error?: string } = {}
  try {
    data = (await response.json()) as { error?: string }
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok) {
    return { success: false, error: data.error ?? 'Failed to send code' }
  }
  return { success: true }
}

/**
 * Send recovery OTP when the user is not signed in (forgot password).
 * Uses Edge Function that validates phone + recovery email server-side.
 */
export async function sendRecoveryOtp(
  phone: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-recovery-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ phone: phone.trim(), email: email.trim() }),
  })

  let data: { error?: string } = {}
  try {
    data = (await response.json()) as { error?: string }
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok) {
    return { success: false, error: data.error ?? 'Failed to send code' }
  }
  return { success: true }
}

/**
 * Verify OTP for authenticated flows (add email, change password, etc.).
 */
export async function verifyEmailOTP(
  email: string,
  otp: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data, error } = await supabase.rpc('verify_email_otp', {
    p_user_id: userId,
    p_email: email.trim(),
    p_otp: otp.trim(),
  })

  if (error != null || data !== true) {
    return {
      success: false,
      error: 'Invalid or expired code. Please try again.',
    }
  }
  return { success: true }
}

export type VerifyRecoveryResult = {
  success: boolean
  error?: string
  /** Pass to complete-recovery-password Edge Function to set a new password (MVP). */
  recoveryToken?: string
}

/**
 * Forgot-password: no Supabase session. Verifies OTP via Edge Function (service role).
 * On success, returns a short-lived recoveryToken used to complete password reset server-side.
 */
export async function verifyRecoveryOTP(
  phone: string,
  email: string,
  otp: string,
): Promise<VerifyRecoveryResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-recovery-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      phone: phone.trim(),
      email: email.trim(),
      otp: otp.trim(),
    }),
  })

  let data: { error?: string; success?: boolean; recoveryToken?: string } = {}
  try {
    data = (await response.json()) as typeof data
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data.error ?? 'Invalid or expired code. Please try again.',
    }
  }

  return {
    success: true,
    recoveryToken: data.recoveryToken,
  }
}

/**
 * Complete forgot-password: set new password using token from verifyRecoveryOTP.
 * TODO: Full flow could issue a Supabase session via Admin API instead.
 */
export async function completeRecoveryPassword(
  recoveryToken: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/complete-recovery-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      recoveryToken,
      newPassword,
    }),
  })

  let data: { error?: string } = {}
  try {
    data = (await response.json()) as { error?: string }
  } catch {
    return { success: false, error: 'Invalid response from server' }
  }

  if (!response.ok) {
    return { success: false, error: data.error ?? 'Could not update password' }
  }
  return { success: true }
}
