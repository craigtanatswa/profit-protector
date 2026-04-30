import { FunctionsHttpError } from '@supabase/functions-js'

import { database } from '../database'
import Business from '../database/models/Business'
import { removeBusinessLogo } from './businessLogo'
import { fetchBusinessRowForUser } from './businessRemote'
import { supabase } from './supabase'
import { clearBusinessSyncCursor } from './sync'

export async function unsafeResetLocalDatabase(): Promise<void> {
  if (!database) return
  const db = database
  await db.write(async () => {
    await db.unsafeResetDatabase()
  })
}

/**
 * Recreates the local `businesses` row from Supabase after a DB reset (same ids as cloud).
 */
export async function reseedLocalBusinessOnly(userId: string): Promise<void> {
  if (!database) return
  const { data: biz, error } = await fetchBusinessRowForUser(userId)
  if (error || !biz) {
    throw new Error(error?.message ?? 'Could not load your business profile from the server.')
  }

  const db = database
  const zigRate =
    typeof biz.zig_rate_per_usd === 'number' && biz.zig_rate_per_usd > 0 ? biz.zig_rate_per_usd : 1
  const recoveryEmail =
    typeof biz.recovery_email === 'string' && biz.recovery_email.trim() !== ''
      ? biz.recovery_email.trim()
      : null

  await db.write(async () => {
    await db.get<Business>('businesses').create((record) => {
      record._raw.id = biz.id
      record.name = biz.name
      record.ownerName = biz.owner_name
      record.phone = biz.phone
      record.businessType = biz.business_type
      record.currency = biz.currency
      record.zigRatePerUsd = zigRate
      record.loginUsername = biz.login_username ?? null
      record.supabaseId = userId
      record.recoveryEmail = recoveryEmail
      record.recoveryEmailVerified = biz.recovery_email_verified === true
    })
  })
}

/**
 * Deletes all business data in Supabase and on device, but keeps the auth user and `businesses` row.
 */
export async function clearBusinessDataEverywhere(
  userId: string,
  businessId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('clear_my_business_data')
  if (error) {
    return {
      ok: false,
      message:
        error.message ??
        'Could not clear cloud data. Ask your administrator to run supabase/sql/account_lifecycle.sql.',
    }
  }

  await clearBusinessSyncCursor(businessId)
  removeBusinessLogo()

  if (database) {
    try {
      await unsafeResetLocalDatabase()
      await reseedLocalBusinessOnly(userId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        message: `Cloud data was cleared but local reset failed: ${msg}`,
      }
    }
  }

  return { ok: true }
}

/**
 * Removes all Supabase rows for the current user via RPC, deletes the auth user (Edge Function + service role),
 * wipes local SQLite, and clears the sync cursor. Does not clear Zustand session — call `logout()` after success.
 */
export async function deleteAccountFully(
  businessId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    return { ok: false, message: 'You are not signed in.' }
  }

  const { data, error: fnError } = await supabase.functions.invoke('delete-account', {
    headers: { Authorization: `Bearer ${token}` },
    body: {},
  })

  if (fnError) {
    let message =
      fnError.message ??
      'Account deletion failed. Deploy the delete-account Edge Function and try again.'

    if (fnError instanceof FunctionsHttpError) {
      try {
        const body = await fnError.context.json()
        if (body && typeof body === 'object' && body !== null && 'error' in body) {
          const fromFn = (body as { error?: string }).error
          if (fromFn) message = fromFn
        }
      } catch {
        /* ignore malformed body */
      }
    }

    return { ok: false, message }
  }

  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    const err = (data as { error?: string }).error
    if (err) {
      return { ok: false, message: err }
    }
  }

  if (businessId) {
    await clearBusinessSyncCursor(businessId)
  }
  removeBusinessLogo()

  if (database) {
    try {
      await unsafeResetLocalDatabase()
    } catch {
      // ignore — auth user is already gone
    }
  }

  return { ok: true }
}
