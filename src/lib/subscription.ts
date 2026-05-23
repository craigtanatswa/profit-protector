import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'
import type { InitiatePaymentResult, Payment, PollResult, Subscription } from '../types'

const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1`

// ── Mapping helpers ────────────────────────────────────────────────────────

function mapSubscription(data: Record<string, unknown>): Subscription {
  return {
    id: data.id as string,
    businessId: data.business_id as string,
    status: data.status as Subscription['status'],
    trialStart: data.trial_start as string,
    trialEnd: data.trial_end as string,
    currentPeriodStart: (data.current_period_start as string | null) ?? null,
    currentPeriodEnd: (data.current_period_end as string | null) ?? null,
    lastPaymentAt: (data.last_payment_at as string | null) ?? null,
    lastPaymentAmountCents: (data.last_payment_amount_cents as number | null) ?? null,
    nextBillingDate: (data.next_billing_date as string | null) ?? null,
    paymentMethod: (data.payment_method as string | null) ?? null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  }
}

function mapPayment(data: Record<string, unknown>): Payment {
  return {
    id: data.id as string,
    businessId: data.business_id as string,
    subscriptionId: (data.subscription_id as string) ?? '',
    paynowReference: (data.paynow_reference as string | null) ?? null,
    paynowPollUrl: (data.paynow_poll_url as string | null) ?? null,
    amountCents: data.amount_cents as number,
    currency: (data.currency as string) ?? 'USD',
    paymentMethod: data.payment_method as string,
    phoneNumber: (data.phone_number as string | null) ?? null,
    status: data.status as Payment['status'],
    paynowStatus: (data.paynow_status as string | null) ?? null,
    createdAt: data.created_at as string,
  }
}

// ── Internal fetch helper ──────────────────────────────────────────────────

async function callFunction(name: string, body: object): Promise<Record<string, unknown>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const resp = await fetch(`${FUNCTION_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: session ? `Bearer ${session.access_token}` : '',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })

  return (await resp.json()) as Record<string, unknown>
}

// ── Sign-then-submit helpers ───────────────────────────────────────────────

interface SignedPayment {
  success: boolean
  paymentId: string
  reference: string
  submitUrl: string
  submitParams: Record<string, string>
  paymentMethod: string
  error?: string
}

/**
 * POSTs the server-signed parameters directly from the client to Paynow.
 * Because this call originates from the user's device rather than the
 * Supabase edge runtime, it bypasses any egress IP restrictions that Paynow
 * may have on Supabase's European data-centre IPs.
 */
async function submitDirectlyToPaynow(
  signed: SignedPayment,
): Promise<URLSearchParams> {
  const params = new URLSearchParams(signed.submitParams)
  const resp = await fetch(signed.submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const text = await resp.text()
  return new URLSearchParams(text)
}

/**
 * Persists the Paynow-issued pollUrl on the payment record for audit and
 * server-side polling. Fire-and-forget — failures are non-fatal because the
 * client holds the pollUrl in memory and passes it directly to paynow-poll.
 */
function persistPollUrl(paymentId: string, pollUrl: string): void {
  callFunction('paynow-confirm', { paymentId, pollUrl }).catch((e) => {
    console.warn('[persistPollUrl] non-fatal:', e)
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function fetchSubscription(businessId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('business_id', businessId)
    .single()

  if (error) {
    // PGRST116 = PostgREST "no rows returned" — the user genuinely has no
    // subscription row yet (e.g. trial not yet created).
    if (error.code === 'PGRST116') return null
    // Any other error (RLS permission denied, network, JWT issues, etc.)
    // should be surfaced so callers can handle it correctly rather than
    // silently treating it as "no subscription = free access".
    throw new Error(`fetchSubscription: ${error.message} (code: ${error.code})`)
  }

  if (!data) return null
  return mapSubscription(data as Record<string, unknown>)
}

export async function initiateEcocashPayment(params: {
  businessId: string
  phoneNumber: string
  authEmail: string
}): Promise<InitiatePaymentResult> {
  const signed = (await callFunction('paynow-initiate', {
    businessId: params.businessId,
    phoneNumber: params.phoneNumber,
    authEmail: params.authEmail,
    paymentMethod: 'ecocash',
  })) as unknown as SignedPayment

  if (!signed.success) {
    return { success: false, message: signed.error ?? 'Payment initiation failed' }
  }

  let fields: URLSearchParams
  try {
    fields = await submitDirectlyToPaynow(signed)
  } catch {
    return { success: false, message: 'Could not reach Paynow. Please check your connection and try again.' }
  }

  const status = fields.get('status') ?? ''
  if (status.toLowerCase() !== 'ok') {
    const errMsg = fields.get('error') ?? 'Payment request was rejected'
    return { success: false, message: errMsg }
  }

  const pollUrl = fields.get('pollurl') ?? ''
  persistPollUrl(signed.paymentId, pollUrl)

  return {
    success: true,
    paymentId: signed.paymentId,
    pollUrl,
    paymentMethod: 'ecocash',
    instructions: `A payment request of $10.00 has been sent to ${params.phoneNumber}. Check your phone and enter your EcoCash PIN to complete payment.`,
  }
}

export async function initiateOnemoneyPayment(params: {
  businessId: string
  phoneNumber: string
  authEmail: string
}): Promise<InitiatePaymentResult> {
  const signed = (await callFunction('paynow-initiate', {
    businessId: params.businessId,
    phoneNumber: params.phoneNumber,
    authEmail: params.authEmail,
    paymentMethod: 'onemoney',
  })) as unknown as SignedPayment

  if (!signed.success) {
    return { success: false, message: signed.error ?? 'Payment initiation failed' }
  }

  let fields: URLSearchParams
  try {
    fields = await submitDirectlyToPaynow(signed)
  } catch {
    return { success: false, message: 'Could not reach Paynow. Please check your connection and try again.' }
  }

  const status = fields.get('status') ?? ''
  if (status.toLowerCase() !== 'ok') {
    const errMsg = fields.get('error') ?? 'Payment request was rejected'
    return { success: false, message: errMsg }
  }

  const pollUrl = fields.get('pollurl') ?? ''
  persistPollUrl(signed.paymentId, pollUrl)

  return {
    success: true,
    paymentId: signed.paymentId,
    pollUrl,
    paymentMethod: 'onemoney',
    instructions: `A payment request of $10.00 has been sent to ${params.phoneNumber}. Check your phone and enter your OneMoney PIN to complete payment.`,
  }
}

export const initiateOneMoneyPayment = initiateOnemoneyPayment

export async function initiateInnbucksPayment(params: {
  businessId: string
  authEmail: string
}): Promise<InitiatePaymentResult> {
  const signed = (await callFunction('paynow-initiate', {
    businessId: params.businessId,
    authEmail: params.authEmail,
    paymentMethod: 'innbucks',
  })) as unknown as SignedPayment

  if (!signed.success) {
    return { success: false, message: signed.error ?? 'Payment initiation failed' }
  }

  let fields: URLSearchParams
  try {
    fields = await submitDirectlyToPaynow(signed)
  } catch {
    return { success: false, message: 'Could not reach Paynow. Please check your connection and try again.' }
  }

  const status = fields.get('status') ?? ''
  if (status.toLowerCase() !== 'ok') {
    const errMsg = fields.get('error') ?? 'Payment request was rejected'
    return { success: false, message: errMsg }
  }

  const pollUrl = fields.get('pollurl') ?? ''
  const authCode = fields.get('authorizationcode') ?? ''
  const authExpires = fields.get('authorizationexpires') ?? ''
  persistPollUrl(signed.paymentId, pollUrl)

  return {
    success: true,
    paymentId: signed.paymentId,
    pollUrl,
    paymentMethod: 'innbucks',
    authorizationCode: authCode,
    authorizationExpires: authExpires,
    deepLink: `com.innbucks.customer://purchase?paymentToken=${authCode}`,
    instructions: `Open your InnBucks app and scan the code or use the authorization code: ${authCode}`,
  }
}

export async function initiateCardPayment(params: {
  businessId: string
  authEmail: string
}): Promise<InitiatePaymentResult> {
  const signed = (await callFunction('paynow-initiate', {
    businessId: params.businessId,
    authEmail: params.authEmail,
    paymentMethod: 'card',
  })) as unknown as SignedPayment

  if (!signed.success) {
    return { success: false, message: signed.error ?? 'Payment initiation failed' }
  }

  let fields: URLSearchParams
  try {
    fields = await submitDirectlyToPaynow(signed)
  } catch {
    return { success: false, message: 'Could not reach Paynow. Please check your connection and try again.' }
  }

  const status = fields.get('status') ?? ''
  if (status.toLowerCase() !== 'ok') {
    const errMsg = fields.get('error') ?? 'Payment request was rejected'
    return { success: false, message: errMsg }
  }

  const pollUrl = fields.get('pollurl') ?? ''
  const redirectUrl = fields.get('browserurl') ?? ''
  persistPollUrl(signed.paymentId, pollUrl)

  return {
    success: true,
    paymentId: signed.paymentId,
    redirectUrl,
    pollUrl,
    paymentMethod: 'zimswitch',
  }
}

export async function pollPaymentStatus(paymentId: string, pollUrl: string): Promise<PollResult> {
  const result = await callFunction('paynow-poll', { paymentId, pollUrl })
  return result as unknown as PollResult
}

export async function fetchPaymentHistory(businessId: string): Promise<Payment[]> {
  const { data } = await supabase
    .from('payments')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (!data) return []
  return (data as Record<string, unknown>[]).map(mapPayment)
}
