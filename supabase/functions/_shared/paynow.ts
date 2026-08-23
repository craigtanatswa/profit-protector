import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha512 } from './crypto.ts'
import { activateSubscription, upgradeSubscriptionTier, type PlanTier } from './subscription.ts'

type SupabaseClient = ReturnType<typeof createClient>

export type PaymentRow = {
  id: string
  business_id: string
  status: string
  plan_tier: string | null
  is_upgrade: boolean | null
  amount_cents: number | null
  paynow_reference?: string | null
}

export function normalizePaynowStatus(status: string): string {
  return status.replace(/\+/g, ' ').trim().toLowerCase()
}

export function isPaidStatus(status: string): boolean {
  const s = normalizePaynowStatus(status)
  return s === 'paid' || s === 'awaiting delivery'
}

export function isCancelledStatus(status: string): boolean {
  const s = normalizePaynowStatus(status)
  return s === 'cancelled' || s === 'disputed'
}

export function parsePaynowForm(bodyText: string): { keys: string[]; map: Record<string, string> } {
  const fields = new URLSearchParams(bodyText)
  const keys: string[] = []
  const map: Record<string, string> = {}
  fields.forEach((value, key) => {
    keys.push(key)
    map[key] = value
  })
  return { keys, map }
}

async function hashFromKeys(
  map: Record<string, string>,
  keys: string[],
  integrationKey: string,
): Promise<string> {
  const payload =
    keys
      .filter((k) => k.toLowerCase() !== 'hash')
      .map((k) => map[k] ?? '')
      .join('') + integrationKey
  return sha512(payload)
}

/**
 * Paynow hashes decoded field values. Official samples use POST order;
 * some integrations use alphabetical keys. Accept either so a real Paid
 * notice is never dropped.
 */
export async function paynowHashMatches(
  bodyText: string,
  integrationKey: string,
): Promise<{ matches: boolean; map: Record<string, string> }> {
  const { keys, map } = parsePaynowForm(bodyText)
  const received = map['hash'] ?? ''
  if (!received) return { matches: false, map }

  const orderHash = await hashFromKeys(map, keys, integrationKey)
  if (orderHash.toLowerCase() === received.toLowerCase()) {
    return { matches: true, map }
  }

  const alphaKeys = Object.keys(map)
    .filter((k) => k.toLowerCase() !== 'hash')
    .sort()
  const alphaHash = await hashFromKeys(map, alphaKeys, integrationKey)
  if (alphaHash.toLowerCase() === received.toLowerCase()) {
    return { matches: true, map }
  }

  console.error(
    JSON.stringify({
      tag: 'paynow_hash_mismatch',
      status: map['status'] ?? '',
      reference: map['reference'] ?? '',
    }),
  )
  return { matches: false, map }
}

export function looksLikePaynowStatusBody(bodyText: string): boolean {
  return /(?:^|&)status=/i.test(bodyText) && !bodyText.includes('Length Required')
}

export async function fetchPaynowPollBody(pollUrl: string): Promise<string> {
  const postResp = await fetch(pollUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': '0',
    },
    body: '',
  })
  const postText = await postResp.text()
  if (postResp.ok && looksLikePaynowStatusBody(postText)) return postText

  const getResp = await fetch(pollUrl)
  return getResp.text()
}

/**
 * Marks the payment paid/cancelled and activates the subscription as soon as
 * Paynow reports Paid or Awaiting Delivery.
 */
export async function settlePaymentFromPaynow(
  supabase: SupabaseClient,
  payment: PaymentRow,
  paynowStatus: string,
): Promise<{ isPaid: boolean; isCancelled: boolean }> {
  const isPaid = isPaidStatus(paynowStatus)
  const isCancelled = isCancelledStatus(paynowStatus)

  if (payment.status === 'paid') {
    return { isPaid: true, isCancelled: false }
  }

  const updateData: Record<string, string> = { paynow_status: paynowStatus }
  if (isPaid) updateData.status = 'paid'
  else if (isCancelled) updateData.status = 'cancelled'

  const { error: updateErr } = await supabase
    .from('payments')
    .update(updateData)
    .eq('id', payment.id)

  if (updateErr) {
    console.error(
      JSON.stringify({
        tag: 'paynow_settle_update_payment',
        paymentId: payment.id,
        error: String(updateErr),
      }),
    )
  }

  if (isPaid && payment.business_id) {
    const tier: PlanTier = payment.plan_tier === 'pro_plus' ? 'pro_plus' : 'pro'
    if (payment.is_upgrade) {
      await upgradeSubscriptionTier(supabase, payment.business_id, tier, payment.amount_cents ?? 0)
    } else {
      await activateSubscription(supabase, payment.business_id, tier)
    }
    console.log(
      JSON.stringify({
        tag: payment.is_upgrade ? 'paynow_settled_upgraded' : 'paynow_settled_activated',
        paymentId: payment.id,
        businessId: payment.business_id,
        paynowStatus,
      }),
    )
  }

  return { isPaid, isCancelled }
}
