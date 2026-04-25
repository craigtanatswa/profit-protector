import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Random token for complete-recovery-password (MVP). */
function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

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

  try {
    const { phone, email, otp } = await req.json()
    if (!phone || !email || !otp) {
      return new Response(
        JSON.stringify({ error: 'Missing phone, email, or code' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .select('user_id, recovery_email, recovery_email_verified')
      .eq('phone', phone.trim())
      .maybeSingle()

    if (bizError) throw bizError
    if (!biz?.user_id) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (biz.recovery_email_verified !== true) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const rem = typeof biz.recovery_email === 'string' ? biz.recovery_email.trim() : ''
    if (!rem || norm(rem) !== norm(email)) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const userId = biz.user_id as string

    const { data: rows, error: evError } = await supabase
      .from('email_verifications')
      .select('id, otp_code, used, expires_at')
      .eq('user_id', userId)
      .eq('email', rem)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)

    if (evError) throw evError
    const row = rows?.[0]
    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const expires = new Date(row.expires_at as string).getTime()
    if (expires < Date.now()) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (String(row.otp_code).trim() !== String(otp).trim()) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    await supabase.from('email_verifications').update({ used: true }).eq('id', row.id)

    const recoveryToken = randomToken()
    const sessionExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    const { error: insErr } = await supabase.from('recovery_password_sessions').insert({
      user_id: userId,
      token: recoveryToken,
      expires_at: sessionExpires,
    })

    if (insErr) {
      console.error(insErr)
      // Table might not exist yet — still return error so client can surface migration need
      return new Response(
        JSON.stringify({ error: 'Server configuration incomplete. Add recovery_password_sessions table.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
      )
    }

    return new Response(
      JSON.stringify({ success: true, recoveryToken }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
