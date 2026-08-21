import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import type { User } from '@supabase/supabase-js'

import { database } from '../database'
import Business from '../database/models/Business'
import { supabase } from './supabase'
import { sendEmailOTP } from './emailOTP'
import {
  businessInfoFromRemoteRow,
  fetchBusinessRowForUser,
  isMissingRecoveryColumnsError,
} from './businessRemote'
import {
  isValidOptionalLoginUsername,
  normalizeOptionalLoginUsername,
  normalizePhone10,
  phone10FromAuthUser,
} from './authIdentity'
import type { BusinessInfo } from '../stores/authStore'

const PENDING_PROFILE_KEY = 'pp_pending_business_profile'

export type PendingBusinessProfile = {
  businessName: string
  ownerName: string
  phone: string
  businessType: string
  currency?: string
  loginUsername?: string
}

export async function savePendingBusinessProfile(
  profile: PendingBusinessProfile,
): Promise<void> {
  const businessName = profile.businessName.trim()
  const ownerName = profile.ownerName.trim()
  const phone = profile.phone.trim()
  if (businessName.length < 2 || ownerName.length < 2 || !/^07\d{8}$/.test(phone)) {
    return
  }
  await SecureStore.setItemAsync(
    PENDING_PROFILE_KEY,
    JSON.stringify({
      businessName,
      ownerName,
      phone,
      businessType: profile.businessType.trim() || 'other',
      currency: profile.currency?.trim() || 'usd',
      loginUsername: profile.loginUsername,
    } satisfies PendingBusinessProfile),
  )
}

export async function loadPendingBusinessProfile(): Promise<PendingBusinessProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingBusinessProfile
    if (
      typeof parsed.businessName !== 'string' ||
      typeof parsed.ownerName !== 'string' ||
      typeof parsed.phone !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function clearPendingBusinessProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_PROFILE_KEY).catch(() => {})
}

let ensureProfileInFlight: Promise<CreateBusinessProfileResult> | null = null

/**
 * After phone verification, the Auth user exists even if the business row was
 * never written (user left signup, signed in, or the app restarted). Complete
 * that row from saved signup details so they enter the app instead of resume-signup.
 */
export async function ensureBusinessProfileForVerifiedSession(
  fallbackPhone = '',
): Promise<CreateBusinessProfileResult> {
  if (ensureProfileInFlight) return ensureProfileInFlight

  ensureProfileInFlight = (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) {
      return { success: false, error: 'You are not signed in. Finish phone verification first.' }
    }

    const existing = await fetchBusinessRowForUser(user.id)
    if (existing.data) {
      await clearPendingBusinessProfile()
      return {
        success: true,
        user,
        businessId: existing.data.id,
        business: businessInfoFromRemoteRow(existing.data),
      }
    }

    const { data: au } = await supabase
      .from('app_users')
      .select('phone, phone_verified')
      .eq('id', user.id)
      .maybeSingle()

    const pending = await loadPendingBusinessProfile()
    const phone =
      normalizePhone10(typeof au?.phone === 'string' ? au.phone : '') ??
      phone10FromAuthUser(user, fallbackPhone) ??
      normalizePhone10(pending?.phone ?? '')
    if (!phone) {
      return { success: false, error: 'Could not finish your business profile. Please sign in again.' }
    }

    const result = await createBusinessProfile({
      businessName: pending?.businessName?.trim() || 'My Business',
      ownerName: pending?.ownerName?.trim() || 'Owner',
      phone,
      businessType: pending?.businessType?.trim() || 'other',
      currency: pending?.currency?.trim() || 'usd',
      loginUsername: pending?.loginUsername,
    })
    if (result.success) {
      await clearPendingBusinessProfile()
    }
    return result
  })()

  try {
    return await ensureProfileInFlight
  } finally {
    ensureProfileInFlight = null
  }
}

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
    const auPhone = normalizePhone10(typeof au.phone === 'string' ? au.phone : '')
    if (auPhone && auPhone !== phone10) {
      return {
        success: false,
        error: 'Phone number does not match your verified account.',
      }
    }
  }

  let businessId: string
  let publicId: string

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
      publicId = `pp-${businessId.slice(0, 8).toLowerCase()}`
      await db.write(async () => {
        await record.update((b) => {
          b.publicId = publicId
        })
      })
    } catch (dbErr: unknown) {
      return {
        success: false,
        error: (dbErr as Error)?.message ?? 'Failed to save business locally.',
      }
    }
  } else {
    businessId = Crypto.randomUUID()
    publicId = `pp-${businessId.slice(0, 8).toLowerCase()}`
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
    public_id: publicId,
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
    const { public_id: _publicId, ...legacyInsertBase } = insertBase
    const retry = await supabase.from('businesses').insert(legacyInsertBase)
    insertError = retry.error
  }

  if (insertError) {
    if (/unique|duplicate|23505/i.test(insertError.message)) {
      const existingAfterInsert = await fetchBusinessRowForUser(user.id)
      if (existingAfterInsert.data) {
        await clearPendingBusinessProfile()
        return {
          success: true,
          user,
          businessId: existingAfterInsert.data.id,
          business: businessInfoFromRemoteRow(existingAfterInsert.data),
        }
      }
      if (loginUsername) {
        return { success: false, error: 'This username is already taken. Please choose another.' }
      }
    }
    return { success: false, error: insertError.message }
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
    publicId,
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
