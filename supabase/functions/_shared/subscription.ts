import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>

export type PlanTier = 'pro' | 'pro_plus'

const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const PLAN_PRICE_CENTS: Record<PlanTier, number> = {
  pro: 500,
  pro_plus: 1000,
}

/**
 * Marks a business subscription as active for the next 30-day period.
 * Called after a successful NEW subscription payment (renewal).
 * Resets current_period_start/end to a fresh 30-day window.
 */
export async function activateSubscription(
  supabase: SupabaseClient,
  businessId: string,
  planTier: PlanTier = 'pro',
): Promise<void> {
  const now = new Date()
  const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DURATION_MS)

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      plan_tier: planTier,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      last_payment_at: now.toISOString(),
      last_payment_amount_cents: PLAN_PRICE_CENTS[planTier],
      next_billing_date: periodEnd.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('business_id', businessId)

  if (error) {
    console.error(
      JSON.stringify({ tag: 'activate_subscription_error', businessId, planTier, error: String(error) }),
    )
    throw error
  }
}

/**
 * Upgrades a subscription's plan tier mid-cycle WITHOUT resetting the billing window.
 * The existing current_period_end / next_billing_date are preserved so the user keeps
 * the time they already paid for. Only the tier and last-payment metadata change.
 */
export async function upgradeSubscriptionTier(
  supabase: SupabaseClient,
  businessId: string,
  planTier: PlanTier,
  proratedAmountCents: number,
): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan_tier: planTier,
      last_payment_at: new Date().toISOString(),
      last_payment_amount_cents: proratedAmountCents,
      updated_at: new Date().toISOString(),
      // current_period_start, current_period_end, next_billing_date intentionally unchanged
    })
    .eq('business_id', businessId)

  if (error) {
    console.error(
      JSON.stringify({ tag: 'upgrade_subscription_tier_error', businessId, planTier, error: String(error) }),
    )
    throw error
  }
}
