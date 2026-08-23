// Deploy: supabase functions deploy paynow-initiate
//
// This function now acts as a "sign-only" endpoint.
// It creates the pending payment record, computes the Paynow hash using the
// secret Integration Key, and returns the signed parameters for the mobile
// client to POST directly to Paynow. The Integration Key never leaves the
// server; the client submits the pre-signed payload.
//
// When isUpgrade=true the function computes server-side proration for a
// Pro → Pro+ mid-cycle upgrade.  If the charge is < $0.50 it upgrades the
// subscription directly and returns { success:true, freeUpgrade:true }.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha512 } from '../_shared/crypto.ts'
import { upgradeSubscriptionTier } from '../_shared/subscription.ts'
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
  // live:
  // pro:      { cents: 500, amountString: '5.00', label: 'Profit Protector Pro'  },
  // pro_plus: { cents: 1000, amountString: '10.00', label: 'Profit Protector Pro+' },
  // TEST pricing — restore live figures before Play Store release
  pro:      { cents: 20, amountString: '0.20', label: 'Profit Protector Pro'  },
  pro_plus: { cents: 30, amountString: '0.30', label: 'Profit Protector Pro+' },
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

  let body: InitiateRequest & { isUpgrade?: boolean }
  try {
    body = (await req.json()) as InitiateRequest & { isUpgrade?: boolean }
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { businessId, paymentMethod, phoneNumber, amount, authEmail } = body
  const isUpgrade = body.isUpgrade === true
  const rawTier = (body.planTier as string | undefined) ?? 'pro'
  const planTier: PlanTier = rawTier === 'pro_plus' ? 'pro_plus' : 'pro'

  if (!businessId) {
    return jsonResponse({ error: 'Missing required field: businessId' }, 400)
  }

  // paymentMethod is only required for paid flows (non-free upgrades will be handled below)
  if (!isUpgrade && !paymentMethod) {
    return jsonResponse({ error: 'Missing required field: paymentMethod' }, 400)
  }

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

  // ── Upgrade path ─────────────────────────────────────────────────────────
  let finalAmountCents: number
  let finalAmountString: string
  let finalAdditionalInfo: string
  let proratedCreditCents = 0

  if (isUpgrade) {
    const { data: currentSub, error: subErr } = await supabase
      .from('subscriptions')
      .select('status, plan_tier, current_period_start, current_period_end')
      .eq('business_id', businessId)
      .maybeSingle()

    if (subErr || !currentSub) {
      console.error(JSON.stringify({ tag: 'paynow_initiate_upgrade_fetch_sub', error: String(subErr) }))
      return jsonResponse({ error: 'Could not fetch subscription details.' }, 500)
    }

    if (currentSub.status !== 'active' && currentSub.status !== 'grace') {
      return jsonResponse({ error: 'You need an active subscription to upgrade.' }, 400)
    }

    if (currentSub.plan_tier === 'pro_plus') {
      return jsonResponse({ error: 'You are already on the Pro+ plan.' }, 400)
    }

    if (!currentSub.current_period_start || !currentSub.current_period_end) {
      return jsonResponse({ error: 'Subscription period data not available.' }, 400)
    }

    // Server-side proration — never trust the client amount for upgrades
    const nowMs = Date.now()
    const startMs = Date.parse(currentSub.current_period_start as string)
    const endMs = Date.parse(currentSub.current_period_end as string)
    const totalMs = Math.max(1, endMs - startMs)
    const remainingMs = Math.max(0, endMs - nowMs)
    const fraction = remainingMs / totalMs

    const proCents = PLAN_PRICES.pro.cents
    const prosPlusCents = PLAN_PRICES.pro_plus.cents
    const creditCents = Math.floor(fraction * proCents)
    const newCostCents = Math.ceil(fraction * prosPlusCents)
    const chargeCents = Math.max(0, newCostCents - creditCents)

    // Free upgrade — proration is less than $0.50, apply immediately
    if (chargeCents < 50) {
      try {
        await upgradeSubscriptionTier(supabase, businessId, 'pro_plus', 0)
      } catch (e) {
        console.error(JSON.stringify({ tag: 'paynow_initiate_free_upgrade', error: String(e) }))
        return jsonResponse({ error: 'Failed to apply free upgrade.' }, 500)
      }
      console.log(JSON.stringify({ tag: 'paynow_initiate_free_upgrade_applied', businessId, chargeCents }))
      return jsonResponse({ success: true, freeUpgrade: true, chargeCents: 0 })
    }

    // Paid upgrade — validate payment method now
    if (!paymentMethod) {
      return jsonResponse({ error: 'Payment method required for this upgrade.' }, 400)
    }

    finalAmountCents = chargeCents
    finalAmountString = (chargeCents / 100).toFixed(2)
    finalAdditionalInfo = 'Profit Protector Pro+ Upgrade'
    proratedCreditCents = creditCents
  } else {
    // Normal renewal — use plan price (ignore client-supplied amount override in production)
    const plan = PLAN_PRICES[planTier]
    finalAmountCents = amount ?? plan.cents
    finalAmountString = plan.amountString
    finalAdditionalInfo = plan.label + ' Monthly Subscription'
  }

  // ── Validate payment method specifics ─────────────────────────────────────
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

  const merchantTrace = crypto.randomUUID().replace(/-/g, '').slice(0, 32)

  const { data: payment, error: insertErr } = await supabase
    .from('payments')
    .insert({
      business_id: businessId,
      amount_cents: finalAmountCents,
      payment_method: storedPaymentMethod,
      plan_tier: isUpgrade ? 'pro_plus' : planTier,
      is_upgrade: isUpgrade,
      proration_credit_cents: proratedCreditCents,
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
      amount: finalAmountString,
      additionalinfo: finalAdditionalInfo,
      returnurl: RETURN_URL,
      resulturl: RESULT_URL,
      authemail: MERCHANT_EMAIL,
      phone,
      method: paymentMethod,
      merchanttrace: merchantTrace,
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
      chargeCents: finalAmountCents,
    })
  }

  // ── InnBucks ───────────────────────────────────────────────────────────────
  if (paymentMethod === 'innbucks') {
    const innbucksParams: Record<string, string> = {
      id: INTEGRATION_ID,
      reference,
      amount: finalAmountString,
      additionalinfo: finalAdditionalInfo,
      returnurl: RETURN_URL,
      resulturl: RESULT_URL,
      authemail: MERCHANT_EMAIL,
      method: 'innbucks',
      merchanttrace: merchantTrace,
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
      chargeCents: finalAmountCents,
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
      amount: finalAmountString,
      additionalinfo: finalAdditionalInfo,
      returnurl: CARD_RETURN_URL,
      resulturl: RESULT_URL,
      authemail: cardAuthEmail,
      merchanttrace: merchantTrace,
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
      chargeCents: finalAmountCents,
    })
  }

  return jsonResponse({ error: `Unsupported payment method: ${paymentMethod}` }, 400)
})
