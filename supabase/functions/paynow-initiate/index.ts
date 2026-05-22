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
import type { InitiateRequest } from '../_shared/types.ts'

const INTEGRATION_ID = Deno.env.get('PAYNOW_INTEGRATION_ID') ?? ''
const INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY') ?? ''
const RESULT_URL = Deno.env.get('PAYNOW_RESULT_URL') ?? ''
const MERCHANT_EMAIL = Deno.env.get('PAYNOW_MERCHANT_EMAIL')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PAYNOW_EXPRESS_URL = 'https://www.paynow.co.zw/interface/remotetransaction'
const PAYNOW_INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction'
const RETURN_URL = 'profitprotector://payment/result'
const ADDITIONAL_INFO = 'Profit Protector Monthly Subscription'
const AMOUNT_STRING = '10.00'

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

async function expressHash(
  reference: string,
  authEmail: string,
  phone: string,
  method: string,
): Promise<string> {
  return sha512(
    INTEGRATION_ID +
      reference +
      AMOUNT_STRING +
      ADDITIONAL_INFO +
      RETURN_URL +
      RESULT_URL +
      authEmail +
      phone +
      method +
      'Message' +
      INTEGRATION_KEY,
  )
}

async function initiateHash(reference: string): Promise<string> {
  return sha512(
    INTEGRATION_ID +
      reference +
      AMOUNT_STRING +
      ADDITIONAL_INFO +
      RETURN_URL +
      RESULT_URL +
      'Message' +
      INTEGRATION_KEY,
  )
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

  const { businessId, paymentMethod, phoneNumber, amount } = body
  const amountCents = amount ?? 1000

  if (!businessId || !paymentMethod) {
    return jsonResponse(
      { error: 'Missing required fields: businessId, paymentMethod' },
      400,
    )
  }

  if ((paymentMethod === 'ecocash' || paymentMethod === 'onemoney') && !phoneNumber) {
    return jsonResponse(
      { error: 'Phone number required for mobile money payments' },
      400,
    )
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

  const merchantTrace = crypto.randomUUID().replace(/-/g, '').slice(0, 32)

  const { data: payment, error: insertErr } = await supabase
    .from('payments')
    .insert({
      business_id: businessId,
      amount_cents: amountCents,
      payment_method: paymentMethod,
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
    const hash = await expressHash(reference, MERCHANT_EMAIL, phone, paymentMethod)

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_EXPRESS_URL,
      submitParams: {
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
        hash,
      },
      paymentMethod,
    })
  }

  // ── InnBucks ───────────────────────────────────────────────────────────────
  if (paymentMethod === 'innbucks') {
    const hash = await expressHash(reference, MERCHANT_EMAIL, '', 'innbucks')

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_EXPRESS_URL,
      submitParams: {
        id: INTEGRATION_ID,
        reference,
        amount: AMOUNT_STRING,
        additionalinfo: ADDITIONAL_INFO,
        returnurl: RETURN_URL,
        resulturl: RESULT_URL,
        authemail: MERCHANT_EMAIL,
        method: 'innbucks',
        status: 'Message',
        hash,
      },
      paymentMethod: 'innbucks',
    })
  }

  // ── Card / web redirect ───────────────────────────────────────────────────
  if (paymentMethod === 'card') {
    const hash = await initiateHash(reference)

    return jsonResponse({
      success: true,
      paymentId: payment.id,
      reference,
      submitUrl: PAYNOW_INITIATE_URL,
      submitParams: {
        id: INTEGRATION_ID,
        reference,
        amount: AMOUNT_STRING,
        additionalinfo: ADDITIONAL_INFO,
        returnurl: RETURN_URL,
        resulturl: RESULT_URL,
        authemail: MERCHANT_EMAIL,
        status: 'Message',
        hash,
      },
      paymentMethod: 'card',
    })
  }

  return jsonResponse({ error: `Unsupported payment method: ${paymentMethod}` }, 400)
})
