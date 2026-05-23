// Deploy: supabase functions deploy paynow-initiate
//
// This function now acts as a "sign-only" endpoint.
// It creates the pending payment record, computes the Paynow hash using the
// secret Integration Key, and returns the signed parameters for the mobile
// client to POST directly to Paynow. The Integration Key never leaves the
// server; the client submits the pre-signed payload.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha512 } from '../_shared/crypto.ts'
import type { InitiateRequest, PlanTier } from '../_shared/types.ts'

const INTEGRATION_ID = Deno.env.get('PAYNOW_INTEGRATION_ID') ?? ''
const INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY') ?? ''
const RESULT_URL = Deno.env.get('PAYNOW_RESULT_URL') ?? ''
const MERCHANT_EMAIL = Deno.env.get('PAYNOW_MERCHANT_EMAIL')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// When true: card authemail is set to the merchant account so you can log in
// and use "TESTING: Faked Success" on Paynow's test checkout page.
// When false (live): customer authEmail is used for a frictionless guest checkout.
const PAYNOW_TEST_MODE =
  (Deno.env.get('PAYNOW_TEST_MODE') ?? '').toLowerCase() === 'true'

const PAYNOW_EXPRESS_URL = 'https://www.paynow.co.zw/interface/remotetransaction'
const PAYNOW_INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction'
// Express checkout (EcoCash/InnBucks) accepts deep links; card payments require https://
const RETURN_URL = 'profitprotector://payment/result'
const CARD_RETURN_URL = `${SUPABASE_URL}/functions/v1/paynow-card-complete`

const PLAN_PRICES: Record<string, { cents: number; amountString: string; label: string }> = {
  pro:      { cents: 1000, amountString: '10.00', label: 'Profit Protector Pro'  },
  pro_plus: { cents: 1500, amountString: '15.00', label: 'Profit Protector Pro+' },
}

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

/**
 * Computes a Paynow hash from a params object using the same algorithm as
 * the official PHP SDK: concatenate all field VALUES in insertion order
 * (skip the hash field itself if present), then append the Integration Key.
 * This guarantees the hash always matches the POST body being submitted.
 */
async function buildHash(params: Record<string, string>): Promise<string> {
  const payload =
    Object.entries(params)
      .filter(([k]) => k.toLowerCase() !== 'hash')
      .map(([, v]) => v)
      .join('') + INTEGRATION_KEY
  return sha512(payload)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!INTEGRATION_ID || !INTEGRATION_KEY || !RESULT_URL) {
    console.error(JSON.stringify({ tag: 'paynow_initiate_config_missing' }))
    return jsonResponse({ error: 'Paynow not configured' }, 500)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(JSON.stringify({ tag: 'paynow_initiate_supabase_config_missing' }))
    return jsonResponse({ error: 'Server misconfiguration' }, 500)
  }

  let body: InitiateRequest
  try {
    body = (await req.json()) as InitiateRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { businessId, paymentMethod, phoneNumber, amount, authEmail } = body
  const rawTier = (body.planTier as string | undefined) ?? 'pro'
  const planTier: PlanTier = rawTier === 'pro_plus' ? 'pro_plus' : 'pro'
  const plan = PLAN_PRICES[planTier]
  const amountCents = amount ?? plan.cents
  const AMOUNT_STRING = plan.amountString
  const ADDITIONAL_INFO = plan.label + ' Monthly Subscription'

  if (!businessId || !paymentMethod) {
    return jsonResponse(
      { error: 'Missing required fields: businessId, paymentMethod' },
      400,
    )
  }

  if (paymentMethod === 'card') {
    if (!authEmail) {
      return jsonResponse({ error: 'Customer email required for card payments' }, 400)
    }
  }

  if ((paymentMethod === 'ecocash' || paymentMethod === 'onemoney') && !phoneNumber) {
    return jsonResponse(
      { error: 'Phone number required for mobile money payments' },
      400,
    )
  }

  const storedPaymentMethod = paymentMethod === 'card' ? 'zimswitch' : paymentMethod

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .maybeSingle()

  if (bizErr) {
    console.error(JSON.stringify({ tag: 'paynow_initiate_biz_lookup', error: String(bizErr) }))
    return jsonResponse({ error: 'Failed to verify business' }, 500)
  }

  if (!business) {
    return jsonResponse({ error: 'Business not found' }, 404)
  }

  const merchantTrace = crypto.randomUUID().replace(/-/g, '').slice(0, 32)

  const { data: payment, error: insertErr } = await supabase
    .from('payments')
    .insert({
      business_id: businessId,
      amount_cents: amountCents,
      payment_method: storedPaymentMethod,
      plan_tier: planTier,
      status: 'pending',
      merchant_trace: merchantTrace,
    })
    .select('id')
    .single()

  if (insertErr || !payment) {
    console.error(
      JSON.stringify({ tag: 'paynow_initiate_insert', error: String(insertErr) }),
    )
    return jsonResponse({ error: 'Failed to create payment record' }, 500)
  }

  const reference = `PP-SUB-${payment.id.slice(0, 8)}`

  // Persist the reference immediately so the webhook can identify this payment
  // before the client even submits to Paynow.
  await supabase
    .from('payments')
    .update({ paynow_reference: reference })
    .eq('id', payment.id)

  // ── EcoCash / OneMoney ────────────────────────────────────────────────────
  if (paymentMethod === 'ecocash' || paymentMethod === 'onemoney') {
    const phone = phoneNumber!
    const expressParams: Record<string, string> = {
      id: INTEGRATION_ID,
      reference,
      amount: AMOUNT_STRING,
      additionalinfo: ADDITIONAL_INFO,
      returnurl: RETURN_URL,
      resulturl: RESULT_URL,
      authemail: MERCHANT_EMAIL,
      phone,
      method: paymentMethod,
      status: 'Message',
    }
    expressParams.hash = await buildHash(expressParams)

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_EXPRESS_URL,
      submitParams: expressParams,
      paymentMethod,
    })
  }

  // ── InnBucks ───────────────────────────────────────────────────────────────
  if (paymentMethod === 'innbucks') {
    const innbucksParams: Record<string, string> = {
      id: INTEGRATION_ID,
      reference,
      amount: AMOUNT_STRING,
      additionalinfo: ADDITIONAL_INFO,
      returnurl: RETURN_URL,
      resulturl: RESULT_URL,
      authemail: MERCHANT_EMAIL,
      method: 'innbucks',
      status: 'Message',
    }
    innbucksParams.hash = await buildHash(innbucksParams)

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_EXPRESS_URL,
      submitParams: innbucksParams,
      paymentMethod: 'innbucks',
    })
  }

  // ── Card (Zimswitch only) ────────────────────────────────────────────────
  // Uses the standard initiate endpoint for both test and live mode.
  // Test mode: authemail = merchant email (log in → "TESTING: Faked Success").
  // Live mode: authemail = customer email for guest checkout.
  if (paymentMethod === 'card') {
    const cardAuthEmail = PAYNOW_TEST_MODE ? MERCHANT_EMAIL : authEmail!

    const cardParams: Record<string, string> = {
      id: INTEGRATION_ID,
      reference,
      amount: AMOUNT_STRING,
      additionalinfo: ADDITIONAL_INFO,
      returnurl: CARD_RETURN_URL,
      resulturl: RESULT_URL,
      authemail: cardAuthEmail,
      status: 'Message',
    }
    cardParams.hash = await buildHash(cardParams)

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_INITIATE_URL,
      submitParams: cardParams,
      paymentMethod: 'zimswitch',
    })
  }

  return jsonResponse({ error: `Unsupported payment method: ${paymentMethod}` }, 400)
})
