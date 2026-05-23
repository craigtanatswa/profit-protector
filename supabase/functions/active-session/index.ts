// Deploy: supabase functions deploy active-session
//
// Registers and validates the single active owner session per user.
// Shopkeeper sessions are managed inside shopkeeper-auth.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization' }, 401)
  }

  let body: { action?: string; deviceId?: string; deviceName?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const action = body.action ?? ''
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401)
  }

  const userId = userData.user.id

  if (action === 'register') {
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    if (!deviceId) {
      return jsonResponse({ error: 'deviceId is required' }, 400)
    }

    const sessionId = crypto.randomUUID()
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : null
    const now = new Date().toISOString()

    const { error } = await admin.from('owner_active_sessions').upsert(
      {
        user_id: userId,
        device_id: deviceId,
        device_name: deviceName,
        session_id: sessionId,
        last_seen_at: now,
      },
      { onConflict: 'user_id' },
    )

    if (error) {
      console.error(JSON.stringify({ tag: 'active_session_register', userId, error: String(error) }))
      return jsonResponse({ error: 'Failed to register active session' }, 500)
    }

    return jsonResponse({ ok: true, sessionId })
  }

  if (action === 'validate') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) {
      return jsonResponse({ ok: false, reason: 'missing_session' })
    }

    const { data, error } = await admin
      .from('owner_active_sessions')
      .select('session_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error(JSON.stringify({ tag: 'active_session_validate', userId, error: String(error) }))
      return jsonResponse({ error: 'Failed to validate session' }, 500)
    }

    if (!data || data.session_id !== sessionId) {
      return jsonResponse({ ok: false, reason: 'superseded' })
    }

    await admin
      .from('owner_active_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', userId)

    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Unknown action' }, 400)
})
