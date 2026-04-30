import * as Crypto from 'expo-crypto'
import type { User } from '@supabase/supabase-js'

import { database } from '../database'
import Business from '../database/models/Business'
import { supabase } from './supabase'
import { sendEmailOTP } from './emailOTP'
import { isMissingRecoveryColumnsError } from './businessRemote'
import {
  isValidOptionalLoginUsername,
  normalizeOptionalLoginUsername,
} from './authIdentity'
import type { BusinessInfo } from '../stores/authStore'

/**
 * Creates the local + remote business row after the user has:
 * - passed Prelude OTP + `verify-otp` (Auth user + `app_users` exist)
 * - established a session via `signInWithPassword`
 */
export interface BusinessProfileParams {
  businessName: string
  ownerName: string
  /** 10-digit local format (07…), must match `app_users.phone` for this session. */
  phone: string
  businessType: string
  currency: string
  recoveryEmail?: string
  loginUsername?: string
}

export type CreateBusinessProfileResult =
  | {
      success: true
      user: User
      businessId: string
      business: BusinessInfo
      pendingRecoveryEmailVerification?: { businessId: string; email: string }
    }
  | { success: false; error: string }

export async function createBusinessProfile(
  params: BusinessProfileParams,
): Promise<CreateBusinessProfileResult> {
  const loginUsername = normalizeOptionalLoginUsername(params.loginUsername ?? '')
  const recoveryEmailTrimmed = (params.recoveryEmail ?? '').trim()
  const phone10 = params.phone.trim()

  if (!isValidOptionalLoginUsername(loginUsername)) {
    return { success: false, error: 'Invalid username' }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const user = session?.user
  if (!user) {
    return {
      success: false,
      error: 'You are not signed in. Finish phone verification first.',
    }
  }

  const { data: au, error: auErr } = await supabase
    .from('app_users')
    .select('phone, phone_verified')
    .eq('id', user.id)
    .maybeSingle()

  if (auErr) {
    return { success: false, error: auErr.message }
  }

  if (au) {
    if (au.phone !== phone10) {
      return {
        success: false,
        error: 'Phone number does not match your verified account.',
      }
    }
    if (au.phone_verified !== true) {
      return {
        success: false,
        error: 'Your phone number is not verified. Complete signup verification first.',
      }
    }
  }

  let businessId: string

  if (database) {
    const db = database
    try {
      const record = await db.write(async () =>
        db.get<Business>('businesses').create((b) => {
          b.name = params.businessName
          b.ownerName = params.ownerName
          b.phone = phone10
          b.businessType = params.businessType
          b.currency = params.currency
          b.zigRatePerUsd = 1
          b.loginUsername = loginUsername || null
          b.supabaseId = user.id
          b.recoveryEmail = recoveryEmailTrimmed || null
          b.recoveryEmailVerified = false
        }),
      )
      businessId = record.id
    } catch (dbErr: unknown) {
      return {
        success: false,
        error: (dbErr as Error)?.message ?? 'Failed to save business locally.',
      }
    }
  } else {
    businessId = Crypto.randomUUID()
  }

  const insertBase = {
    id: businessId,
    name: params.businessName,
    owner_name: params.ownerName,
    phone: phone10,
    business_type: params.businessType,
    currency: params.currency,
    zig_rate_per_usd: 1,
    login_username: loginUsername || null,
    user_id: user.id,
    created_at: new Date().toISOString(),
  }

  let insertError = (
    await supabase.from('businesses').insert({
      ...insertBase,
      recovery_email: recoveryEmailTrimmed || null,
      recovery_email_verified: false,
    })
  ).error

  if (insertError && isMissingRecoveryColumnsError(insertError)) {
    const retry = await supabase.from('businesses').insert(insertBase)
    insertError = retry.error
  }

  if (insertError) {
    let insMsg = insertError.message
    if (/unique|duplicate|23505/i.test(insMsg) && loginUsername) {
      insMsg = 'This username is already taken. Please choose another.'
    }
    return { success: false, error: insMsg }
  }

  const business: BusinessInfo = {
    id: businessId,
    name: params.businessName,
    ownerName: params.ownerName,
    phone: phone10,
    businessType: params.businessType,
    currency: params.currency,
    zigRatePerUsd: 1,
    loginUsername: loginUsername || null,
    recoveryEmail: recoveryEmailTrimmed || undefined,
    recoveryEmailVerified: false,
  }

  if (recoveryEmailTrimmed) {
    const sent = await sendEmailOTP(recoveryEmailTrimmed, 'add_email')
    if (!sent.success) {
      console.warn(sent.error ?? 'Recovery email OTP failed')
    }
    return {
      success: true,
      user,
      businessId,
      business,
      pendingRecoveryEmailVerification: { businessId, email: recoveryEmailTrimmed },
    }
  }

  return {
    success: true,
    user,
    businessId,
    business,
  }
}
