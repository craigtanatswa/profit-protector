import type { PostgrestError } from '@supabase/supabase-js'

import type { BusinessInfo } from '../stores/authStore'
import { supabase } from './supabase'

/** Columns always present on `businesses` (before recovery-email migration). */
export const BUSINESS_SELECT_BASE =
  'id, name, owner_name, phone, business_type, currency, login_username, zig_rate_per_usd' as const

export const BUSINESS_SELECT_WITH_RECOVERY =
  `${BUSINESS_SELECT_BASE}, recovery_email, recovery_email_verified` as const

export type BusinessRowBase = {
  id: string
  name: string
  owner_name: string
  phone: string
  business_type: string
  currency: string
  login_username: string | null
  zig_rate_per_usd: number | null
}

export type BusinessRowForAuth = BusinessRowBase & {
  recovery_email: string | null
  recovery_email_verified: boolean
}

export function businessInfoFromRemoteRow(biz: BusinessRowForAuth): BusinessInfo {
  const zigRate =
    typeof biz.zig_rate_per_usd === 'number' && biz.zig_rate_per_usd > 0 ? biz.zig_rate_per_usd : 1
  const recoveryEmailVerified = biz.recovery_email_verified === true
  const recoveryEmail =
    typeof biz.recovery_email === 'string' && biz.recovery_email.trim() !== ''
      ? biz.recovery_email.trim()
      : undefined

  return {
    id: biz.id,
    name: biz.name,
    ownerName: biz.owner_name,
    phone: biz.phone,
    businessType: biz.business_type,
    currency: biz.currency,
    zigRatePerUsd: zigRate,
    loginUsername: biz.login_username ?? null,
    recoveryEmail,
    recoveryEmailVerified,
  }
}

export function isMissingRecoveryColumnsError(error: PostgrestError | null): boolean {
  if (error == null) return false
  const msg = `${error.message} ${error.details ?? ''}`.toLowerCase()
  if (msg.includes('recovery_email')) return true
  if (msg.includes('recovery_email_verified')) return true
  if (msg.includes('column') && msg.includes('does not exist')) return true
  if (msg.includes("could not find") && msg.includes('column')) return true
  return false
}

/**
 * Load the signed-in user's business row. If Supabase has not been migrated with
 * recovery email columns yet, falls back to a smaller select so login and data
 * restore still work.
 */
export async function fetchBusinessRowForUser(
  userId: string,
): Promise<{ data: BusinessRowForAuth | null; error: PostgrestError | null }> {
  const first = await supabase
    .from('businesses')
    .select(BUSINESS_SELECT_WITH_RECOVERY)
    .eq('user_id', userId)
    .single()

  if (!first.error && first.data) {
    const row = first.data as unknown as BusinessRowForAuth
    return {
      data: {
        ...row,
        recovery_email:
          typeof row.recovery_email === 'string' ? row.recovery_email : null,
        recovery_email_verified: row.recovery_email_verified === true,
      },
      error: null,
    }
  }

  if (first.error && isMissingRecoveryColumnsError(first.error)) {
    const second = await supabase
      .from('businesses')
      .select(BUSINESS_SELECT_BASE)
      .eq('user_id', userId)
      .single()

    if (second.error || !second.data) {
      return { data: null, error: second.error }
    }

    const base = second.data as unknown as BusinessRowBase
    return {
      data: {
        ...base,
        recovery_email: null,
        recovery_email_verified: false,
      },
      error: null,
    }
  }

  return { data: null, error: first.error }
}
