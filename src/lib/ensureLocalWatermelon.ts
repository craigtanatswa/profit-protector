import { Q } from '@nozbe/watermelondb'
import type { User } from '@supabase/supabase-js'

import { database } from '../database'
import Business from '../database/models/Business'
import type { BusinessInfo } from '../stores/authStore'
import { unsafeResetLocalDatabase, reseedLocalBusinessOnly } from './accountLifecycle'
import type { BusinessRowForAuth } from './businessRemote'
import { supabase } from './supabase'
import { clearBusinessSyncCursor, syncAll } from './sync'

/**
 * When the network is unavailable (e.g. cold start offline), rebuild `BusinessInfo` from the
 * local `businesses` row so tabs and dashboard queries still have a `business.id`.
 */
export async function businessInfoFromLocalWatermelon(userId: string): Promise<BusinessInfo | null> {
  if (!database) return null
  const rows = await database.get<Business>('businesses').query().fetch()
  const row = rows.find((r) => r.supabaseId === userId)
  if (!row) return null
  const zig =
    typeof row.zigRatePerUsd === 'number' && row.zigRatePerUsd > 0 ? row.zigRatePerUsd : 1
  return {
    id: row.id,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    businessType: row.businessType,
    currency: row.currency,
    zigRatePerUsd: zig,
    loginUsername: row.loginUsername ?? null,
    recoveryEmail: row.recoveryEmail ?? undefined,
    recoveryEmailVerified: row.recoveryEmailVerified === true,
  }
}

/**
 * Keeps WatermelonDB aligned with Supabase after login / session restore:
 * - Local `businesses.id` must match cloud `businesses.id` (dashboard queries use auth store id).
 * - If the device has no products for that business but Supabase does, reset the sync cursor and
 *   run a full sync — otherwise `last_sync_*` can be ahead of row timestamps and pulls nothing.
 */
export async function ensureLocalWatermelonForSession(
  user: User,
  biz: BusinessRowForAuth,
): Promise<void> {
  if (!database) return

  const rows = await database.get<Business>('businesses').query().fetch()
  const localBiz = rows.find((r) => r.supabaseId === user.id)

  if (!localBiz) {
    return
  }

  if (localBiz.id !== biz.id) {
    await unsafeResetLocalDatabase()
    await reseedLocalBusinessOnly(user.id)
    await clearBusinessSyncCursor(biz.id)
    await syncAll(biz.id)
    return
  }

  const localProductCount = await database
    .get('products')
    .query(Q.where('business_id', biz.id))
    .fetchCount()

  if (localProductCount > 0) {
    return
  }

  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', biz.id)

  if (error || count == null || count === 0) {
    return
  }

  await clearBusinessSyncCursor(biz.id)
  await syncAll(biz.id)
}
