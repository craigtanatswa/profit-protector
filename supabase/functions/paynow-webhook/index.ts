// Deploy: supabase functions deploy paynow-webhook

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha512 } from '../_shared/crypto.ts'
import { activateSubscription } from '../_shared/subscription.ts'

const INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PAID_STATUSES = ['Paid', 'Awaiting Delivery']

/**
 * Always return 200 OK to Paynow — even on validation failure — so it does
 * not keep retrying. We silently drop requests that fail hash validation.
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

  // Parse URL-encoded POST body from Paynow
  const fields = new URLSearchParams(bodyText)
  const fieldMap: Record<string, string> = {}
  fields.forEach((value, key) => {
    fieldMap[key] = value
  })

  const receivedHash = fieldMap['hash'] ?? ''

  // ── Hash validation ────────────────────────────────────────────────────────
  // Concatenate all field values EXCEPT hash in alphabetical key order, then
  // append the integration key. SHA-512 the result and compare.
  const sortedKeys = Object.keys(fieldMap)
    .filter((k) => k !== 'hash')
    .sort()

  const hashInput = sortedKeys.map((k) => fieldMap[k]).join('') + INTEGRATION_KEY

  let expectedHash: string
  try {
    expectedHash = await sha512(hashInput)
  } catch (e) {
    console.error(JSON.stringify({ tag: 'paynow_webhook_hash_compute', error: String(e) }))
    return ok()
  }

  if (expectedHash.toLowerCase() !== receivedHash.toLowerCase()) {
    console.error(
      JSON.stringify({
        tag: 'paynow_webhook_hash_mismatch',
        received: receivedHash,
        expected: expectedHash,
      }),
    )
    return ok()
  }

  // ── Process valid notification ─────────────────────────────────────────────
  const paynowStatus = fieldMap['status'] ?? ''
  const reference = fieldMap['reference'] ?? ''

  if (!PAID_STATUSES.includes(paynowStatus)) {
    // Status is not a paid state — nothing to do (could be a Cancelled notification)
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

  // Look up the payment by the Paynow reference we set on initiation
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, business_id, status')
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

  // Idempotency guard — skip if already marked paid
  if (payment.status === 'paid') {
    return ok()
  }

  const { error: updateErr } = await supabase
    .from('payments')
    .update({ status: 'paid', paynow_status: paynowStatus })
    .eq('id', payment.id)

  if (updateErr) {
    console.error(
      JSON.stringify({
        tag: 'paynow_webhook_update_payment',
        paymentId: payment.id,
        error: String(updateErr),
      }),
    )
  }

  try {
    await activateSubscription(supabase, payment.business_id)
    console.log(
      JSON.stringify({
        tag: 'paynow_webhook_activated',
        paymentId: payment.id,
        businessId: payment.business_id,
      }),
    )
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
