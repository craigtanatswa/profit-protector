/**
 * send-owner-push — Expo Push fan-out for the business owner.
 *
 * Auth (one of):
 *   • x-internal-push-secret: <secret>  — server-side calls from shopkeeper-auth
 *   • Bearer <user JWT>                 — owner-facing calls
 *
 * Body (JSON):
 *   business_id              string   required
 *   title                    string   required
 *   body                     string   required
 *   data                     object   optional  { key: string }
 *   android_channel          string   optional  (default: 'default')
 *   exclude_expo_push_token  string   optional  (skip token already on calling device)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const INTERNAL_SECRET = Deno.env.get('LOW_STOCK_INTERNAL_SECRET')

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_CHUNK_SIZE = 90 // Expo's max messages per request

type JsonBody = {
  business_id?: string
  title?: string
  body?: string
  data?: Record<string, string>
  android_channel?: string
  exclude_expo_push_token?: string | null
}

type ExpoTicket = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server misconfiguration' }, 500)
  }

  let payload: JsonBody
  try {
    payload = (await req.json()) as JsonBody
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const businessId = payload.business_id?.trim()
  if (!businessId) return jsonResponse({ error: 'Missing business_id' }, 400)

  const title = payload.title?.trim()
  const pushBody = payload.body?.trim()
  if (!title || !pushBody) {
    return jsonResponse({ error: 'Missing title or body' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // --- Auth ---
  const internalHeader = req.headers.get('x-internal-push-secret')?.trim()
  const isInternal =
    internalHeader != null &&
    internalHeader.length > 0 &&
    INTERNAL_SECRET != null &&
    internalHeader === INTERNAL_SECRET

  if (!isInternal) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return jsonResponse({ error: 'Missing Authorization' }, 401)

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('user_id', userData.user.id)
      .maybeSingle()

    if (bizErr || !biz) {
      return jsonResponse({ error: 'Business not found or access denied' }, 403)
    }
  }

  // --- Look up owner ---
  const { data: businessRow, error: businessErr } = await admin
    .from('businesses')
    .select('user_id')
    .eq('id', businessId)
    .maybeSingle()

  if (businessErr || !businessRow?.user_id) {
    return jsonResponse({ error: 'Business not found' }, 404)
  }

  const ownerUserId = businessRow.user_id as string

  // --- Load tokens ---
  const { data: tokenRows, error: tokErr } = await admin
    .from('owner_expo_push_tokens')
    .select('expo_push_token')
    .eq('user_id', ownerUserId)

  if (tokErr) return jsonResponse({ error: tokErr.message }, 500)

  const exclude = payload.exclude_expo_push_token?.trim()
  const tokens = (tokenRows ?? [])
    .map((r) => r.expo_push_token as string)
    .filter((t) => Boolean(t) && t !== exclude)

  if (tokens.length === 0) {
    console.log(`[send-owner-push] No tokens for user ${ownerUserId} (business ${businessId})`)
    return jsonResponse({ ok: true, sent: 0 })
  }

  const androidChannel = payload.android_channel?.trim() || 'default'
  const data: Record<string, string> = payload.data ?? {}

  // --- Fan-out in batches ---
  let sentOk = 0
  const staleTokens: string[] = []

  for (let i = 0; i < tokens.length; i += EXPO_CHUNK_SIZE) {
    const batch = tokens.slice(i, i + EXPO_CHUNK_SIZE)

    const messages = batch.map((to) => ({
      to,
      title,
      body: pushBody,
      data,
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: androidChannel,
    }))

    const expoRes = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      // Expo push endpoint expects an array of messages, not { messages: [...] }.
      body: JSON.stringify(messages),
    })

    if (!expoRes.ok) {
      const errText = await expoRes.text()
      console.error('[send-owner-push] Expo HTTP error:', expoRes.status, errText.slice(0, 300))
      return jsonResponse({ error: 'Expo push failed', detail: errText.slice(0, 200) }, 502)
    }

    const expoJson = (await expoRes.json()) as { data?: ExpoTicket[] }
    const tickets: ExpoTicket[] = Array.isArray(expoJson.data) ? expoJson.data : []

    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'ok') {
        sentOk++
      } else {
        const token = batch[idx]
        const errCode = ticket.details?.error
        console.warn(`[send-owner-push] Ticket error for token ${token?.slice(0, 20)}…: ${ticket.message} (${errCode})`)

        // Prune tokens that are no longer valid — device uninstalled or revoked
        if (errCode === 'DeviceNotRegistered' || errCode === 'InvalidCredentials') {
          if (token) staleTokens.push(token)
        }
      }
    })
  }

  // Remove stale tokens so future pushes don't waste requests
  if (staleTokens.length > 0) {
    console.log(`[send-owner-push] Pruning ${staleTokens.length} stale token(s)`)
    await admin
      .from('owner_expo_push_tokens')
      .delete()
      .in('expo_push_token', staleTokens)
      .eq('user_id', ownerUserId)
  }

  console.log(`[send-owner-push] Sent ${sentOk}/${tokens.length} to business ${businessId}`)
  return jsonResponse({ ok: true, sent: sentOk })
})
