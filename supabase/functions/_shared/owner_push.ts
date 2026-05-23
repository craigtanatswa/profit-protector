/**
 * Server-side fan-out to the business owner's registered Expo push tokens.
 * Used by shopkeeper-auth (staff sales) and optional DB triggers.
 */

export async function sendOwnerPushInternal(params: {
  businessId: string
  title: string
  body: string
  data?: Record<string, string>
  androidChannel?: string
}): Promise<{ ok: boolean; sent?: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = Deno.env.get('LOW_STOCK_INTERNAL_SECRET')

  if (!supabaseUrl || !serviceKey || !secret) {
    console.warn('[owner_push] Missing SUPABASE_URL, service key, or LOW_STOCK_INTERNAL_SECRET')
    return { ok: false }
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-owner-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'x-internal-push-secret': secret,
      },
      body: JSON.stringify({
        business_id: params.businessId,
        title: params.title,
        body: params.body,
        data: params.data ?? {},
        android_channel: params.androidChannel,
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.warn('[owner_push] send-owner-push failed:', res.status, detail.slice(0, 200))
      return { ok: false }
    }

    const json = (await res.json()) as { ok?: boolean; sent?: number }
    return { ok: json.ok === true, sent: json.sent }
  } catch (e) {
    console.warn('[owner_push] send-owner-push error:', e)
    return { ok: false }
  }
}
