// Deploy: supabase functions deploy paynow-confirm
//
// Called by the mobile client after it has submitted the signed payload
// directly to Paynow and received a pollUrl in the response. This function
// persists the pollUrl on the payment record for audit and server-side
// polling purposes.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    console.error(JSON.stringify({ tag: 'paynow_confirm_config_missing' }))
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

  // Verify the payment exists and is still pending before accepting the pollUrl
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, status')
    .eq('id', paymentId)
    .maybeSingle()

  if (fetchErr) {
    console.error(JSON.stringify({ tag: 'paynow_confirm_fetch', error: String(fetchErr) }))
    return jsonResponse({ error: 'Failed to verify payment' }, 500)
  }

  if (!payment) {
    return jsonResponse({ error: 'Payment not found' }, 404)
  }

  // Idempotent — if already processed, acknowledge without overwriting
  if (payment.status !== 'pending') {
    return jsonResponse({ success: true })
  }

  const { error: updateErr } = await supabase
    .from('payments')
    .update({ paynow_poll_url: pollUrl })
    .eq('id', paymentId)

  if (updateErr) {
    // Non-fatal: the client holds the pollUrl in memory and can still poll
    console.error(
      JSON.stringify({ tag: 'paynow_confirm_update', paymentId, error: String(updateErr) }),
    )
  }

  return jsonResponse({ success: true })
})
