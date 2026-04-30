import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse } from '../_shared/cors.ts'
import { preludeCreateVerification } from '../_shared/prelude.ts'
import { normalizeZimbabwePhone } from '../_shared/phone.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const PRELUDE_API_KEY = Deno.env.get('PRELUDE_API_KEY')

const RATE_LIMIT_MS = 60_000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Server misconfiguration' }, 500)
  }
  if (!PRELUDE_API_KEY) {
    return jsonResponse({ error: 'SMS verification not configured' }, 500)
  }

  try {
    const body = await req.json() as { phone?: string }
    const normalized = normalizeZimbabwePhone(String(body.phone ?? ''))
    if (!normalized) {
      return jsonResponse(
        {
          error:
            'Invalid phone number. Use Zimbabwe format (+263…) or 10 digits starting with 07.',
        },
        400,
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: rateRow, error: rateErr } = await supabase
      .from('prelude_otp_send_rate')
      .select('last_sent_at')
      .eq('phone_e164', normalized)
      .maybeSingle()

    if (rateErr) throw rateErr
    if (rateRow?.last_sent_at) {
      const last = new Date(rateRow.last_sent_at as string).getTime()
      if (Date.now() - last < RATE_LIMIT_MS) {
        return jsonResponse(
          { error: 'Please wait before requesting another code.' },
          429,
        )
      }
    }

    const pv = await preludeCreateVerification(normalized, PRELUDE_API_KEY)
    if (!pv.ok) {
      console.error(JSON.stringify({ tag: 'prelude_send_failed', detail: pv.detail }))
      return jsonResponse({ error: pv.detail }, 502)
    }

    const { error: upsertErr } = await supabase.from('prelude_otp_send_rate').upsert(
      { phone_e164: normalized, last_sent_at: new Date().toISOString() },
      { onConflict: 'phone_e164' },
    )

    if (upsertErr) throw upsertErr

    return jsonResponse({ success: true }, 200)
  } catch (e) {
    console.error(JSON.stringify({ tag: 'send_otp_error', message: String(e) }))
    return jsonResponse({ error: 'Unexpected error' }, 500)
  }
})
