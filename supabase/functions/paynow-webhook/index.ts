// Deploy: supabase functions deploy paynow-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isPaidStatus, paynowHashMatches, settlePaymentFromPaynow } from '../_shared/paynow.ts'

const INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/**
 * Always return 200 OK to Paynow — even on validation failure — so it does
 * not keep retrying. Invalid hashes are logged and dropped.
 */
function ok(): Response {
  return new Response('OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
    })
  }

  if (req.method !== 'POST') {
    return ok()
  }

  if (!INTEGRATION_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(JSON.stringify({ tag: 'paynow_webhook_config_missing' }))
    return ok()
  }

  let bodyText: string
  try {
    bodyText = await req.text()
  } catch (e) {
    console.error(JSON.stringify({ tag: 'paynow_webhook_body_read', error: String(e) }))
    return ok()
  }

  if (!bodyText) {
    return ok()
  }

  const { matches, map } = await paynowHashMatches(bodyText, INTEGRATION_KEY)
  const paynowStatus = map['status'] ?? ''
  const reference = map['reference'] ?? ''

  if (!matches) {
    console.error(
      JSON.stringify({
        tag: 'paynow_webhook_hash_mismatch',
        status: paynowStatus,
        reference,
      }),
    )
    return ok()
  }

  if (!isPaidStatus(paynowStatus)) {
    console.log(
      JSON.stringify({ tag: 'paynow_webhook_non_paid', status: paynowStatus, reference }),
    )
    return ok()
  }

  if (!reference) {
    console.error(JSON.stringify({ tag: 'paynow_webhook_missing_reference' }))
    return ok()
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, business_id, status, plan_tier, is_upgrade, amount_cents, paynow_reference')
    .eq('paynow_reference', reference)
    .maybeSingle()

  if (fetchErr) {
    console.error(
      JSON.stringify({ tag: 'paynow_webhook_fetch_payment', reference, error: String(fetchErr) }),
    )
    return ok()
  }

  if (!payment) {
    console.error(JSON.stringify({ tag: 'paynow_webhook_payment_not_found', reference }))
    return ok()
  }

  try {
    await settlePaymentFromPaynow(supabase, payment, paynowStatus)
  } catch (e) {
    console.error(
      JSON.stringify({
        tag: 'paynow_webhook_activate_subscription',
        paymentId: payment.id,
        businessId: payment.business_id,
        error: String(e),
      }),
    )
  }

  return ok()
})
