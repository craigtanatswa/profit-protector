import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>

const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const LAST_PAYMENT_AMOUNT_CENTS = 1000

/**
 * Marks a business subscription as active for the next 30-day period.
 * Called after a successful payment is confirmed either via poll or webhook.
 */
export async function activateSubscription(
  supabase: SupabaseClient,
  businessId: string,
): Promise<void> {
  const now = new Date()
  const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DURATION_MS)

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      last_payment_at: now.toISOString(),
      last_payment_amount_cents: LAST_PAYMENT_AMOUNT_CENTS,
      next_billing_date: periodEnd.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('business_id', businessId)

  if (error) {
    console.error(
      JSON.stringify({ tag: 'activate_subscription_error', businessId, error: String(error) }),
    )
    throw error
  }
}
