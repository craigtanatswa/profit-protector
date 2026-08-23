// Deploy: supabase functions deploy paynow-poll

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  fetchPaynowPollBody,
  looksLikePaynowStatusBody,
  paynowHashMatches,
  settlePaymentFromPaynow,
} from '../_shared/paynow.ts'

const INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(JSON.stringify({ tag: 'paynow_poll_config_missing' }))
    return jsonResponse({ error: 'Server misconfiguration' }, 500)
  }

  let body: { paymentId?: string; pollUrl?: string; pollBody?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { paymentId, pollUrl } = body
  let pollBody = typeof body.pollBody === 'string' ? body.pollBody : ''

  if (!paymentId) {
    return jsonResponse({ error: 'Missing required field: paymentId' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: paymentRecord, error: fetchErr } = await supabase
    .from('payments')
    .select('id, business_id, status, plan_tier, is_upgrade, amount_cents, paynow_reference, paynow_poll_url')
    .eq('id', paymentId)
    .maybeSingle()

  if (fetchErr) {
    console.error(JSON.stringify({ tag: 'paynow_poll_fetch_payment', error: String(fetchErr) }))
    return jsonResponse({ error: 'Failed to fetch payment record' }, 500)
  }

  if (!paymentRecord) {
    return jsonResponse({ error: 'Payment not found' }, 404)
  }

  if (paymentRecord.status === 'paid' || paymentRecord.status === 'cancelled') {
    return jsonResponse({
      status: paymentRecord.status,
      isPaid: paymentRecord.status === 'paid',
    })
  }

  const resolvedPollUrl = pollUrl || paymentRecord.paynow_poll_url || ''

  if (!looksLikePaynowStatusBody(pollBody) && resolvedPollUrl) {
    try {
      pollBody = await fetchPaynowPollBody(resolvedPollUrl)
    } catch (e) {
      console.error(JSON.stringify({ tag: 'paynow_poll_fetch_url', paymentId, error: String(e) }))
      return jsonResponse({ error: 'Failed to reach Paynow' }, 502)
    }
  }

  if (!looksLikePaynowStatusBody(pollBody)) {
    console.error(JSON.stringify({ tag: 'paynow_poll_invalid_body', paymentId }))
    return jsonResponse({ error: 'Could not read Paynow status' }, 502)
  }

  async function verifiedStatus(raw: string): Promise<{ ok: boolean; status: string; reference: string }> {
    if (!INTEGRATION_KEY) {
      const fields = new URLSearchParams(raw)
      return {
        ok: true,
        status: fields.get('status') ?? '',
        reference: fields.get('reference') ?? '',
      }
    }
    const verified = await paynowHashMatches(raw, INTEGRATION_KEY)
    return {
      ok: verified.matches,
      status: verified.map['status'] ?? '',
      reference: verified.map['reference'] ?? '',
    }
  }

  let checked = await verifiedStatus(pollBody)
  if (!checked.ok && resolvedPollUrl) {
    try {
      pollBody = await fetchPaynowPollBody(resolvedPollUrl)
      checked = await verifiedStatus(pollBody)
    } catch (e) {
      console.error(JSON.stringify({ tag: 'paynow_poll_fetch_url', paymentId, error: String(e) }))
    }
  }

  if (!checked.ok) {
    console.error(JSON.stringify({ tag: 'paynow_poll_hash_mismatch', paymentId, status: checked.status }))
    return jsonResponse({ status: checked.status, isPaid: false, error: 'Could not verify Paynow status' }, 400)
  }

  const paynowStatus = checked.status
  if (checked.reference && paymentRecord.paynow_reference && checked.reference !== paymentRecord.paynow_reference) {
    return jsonResponse({ error: 'Paynow reference mismatch' }, 400)
  }

  try {
    const settled = await settlePaymentFromPaynow(supabase, paymentRecord, paynowStatus)
    return jsonResponse({ status: paynowStatus || (settled.isPaid ? 'Paid' : paymentRecord.status), isPaid: settled.isPaid })
  } catch (e) {
    console.error(
      JSON.stringify({
        tag: 'paynow_poll_activate_subscription',
        paymentId,
        businessId: paymentRecord.business_id,
        error: String(e),
      }),
    )
    return jsonResponse({ error: 'Failed to activate subscription' }, 500)
  }
})
