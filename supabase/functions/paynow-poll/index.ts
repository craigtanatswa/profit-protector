// Deploy: supabase functions deploy paynow-poll

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { activateSubscription } from '../_shared/subscription.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PAID_STATUSES = ['Paid', 'Awaiting Delivery']
const FAILED_STATUSES = ['Cancelled', 'Disputed']

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

  let body: { paymentId?: string; pollUrl?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { paymentId, pollUrl } = body

  if (!paymentId || !pollUrl) {
    return jsonResponse({ error: 'Missing required fields: paymentId, pollUrl' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Fetch payment record to get business_id and plan tier
  const { data: paymentRecord, error: fetchErr } = await supabase
    .from('payments')
    .select('id, business_id, status, plan_tier')
    .eq('id', paymentId)
    .maybeSingle()

  if (fetchErr) {
    console.error(JSON.stringify({ tag: 'paynow_poll_fetch_payment', error: String(fetchErr) }))
    return jsonResponse({ error: 'Failed to fetch payment record' }, 500)
  }

  if (!paymentRecord) {
    return jsonResponse({ error: 'Payment not found' }, 404)
  }

  // If already in a terminal state, return current status without polling again
  if (paymentRecord.status === 'paid' || paymentRecord.status === 'cancelled') {
    return jsonResponse({
      status: paymentRecord.status,
      isPaid: paymentRecord.status === 'paid',
    })
  }

  // Poll Paynow for current status
  let paynowStatus: string
  try {
    const pollResp = await fetch(pollUrl)
    const pollText = await pollResp.text()
    const pollFields = new URLSearchParams(pollText)
    paynowStatus = pollFields.get('status') ?? ''
  } catch (e) {
    console.error(JSON.stringify({ tag: 'paynow_poll_fetch_url', paymentId, error: String(e) }))
    return jsonResponse({ error: 'Failed to reach Paynow' }, 502)
  }

  const isPaid = PAID_STATUSES.includes(paynowStatus)
  const isCancelled = FAILED_STATUSES.includes(paynowStatus)

  // Build update payload
  const updateData: Record<string, string> = { paynow_status: paynowStatus }
  if (isPaid) {
    updateData.status = 'paid'
  } else if (isCancelled) {
    updateData.status = 'cancelled'
  }

  const { error: updateErr } = await supabase
    .from('payments')
    .update(updateData)
    .eq('id', paymentId)

  if (updateErr) {
    console.error(
      JSON.stringify({ tag: 'paynow_poll_update_payment', paymentId, error: String(updateErr) }),
    )
  }

  // Activate subscription on successful payment, preserving the plan tier
  if (isPaid && paymentRecord.business_id) {
    const tier = paymentRecord.plan_tier === 'pro_plus' ? 'pro_plus' : 'pro'
    try {
      await activateSubscription(supabase, paymentRecord.business_id, tier)
    } catch (e) {
      console.error(
        JSON.stringify({
          tag: 'paynow_poll_activate_subscription',
          paymentId,
          businessId: paymentRecord.business_id,
          error: String(e),
        }),
      )
    }
  }

  return jsonResponse({ status: paynowStatus, isPaid })
})
