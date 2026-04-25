import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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
    const { recoveryToken, newPassword } = await req.json()
    if (!recoveryToken || !newPassword) {
      return new Response(
        JSON.stringify({ error: 'Missing token or password' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (String(newPassword).length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: sessionRow, error: findErr } = await supabase
      .from('recovery_password_sessions')
      .select('id, user_id, expires_at')
      .eq('token', String(recoveryToken).trim())
      .maybeSingle()

    if (findErr) throw findErr
    if (!sessionRow) {
      return new Response(JSON.stringify({ error: 'Invalid or expired recovery session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const exp = new Date(sessionRow.expires_at as string).getTime()
    if (exp < Date.now()) {
      await supabase.from('recovery_password_sessions').delete().eq('id', sessionRow.id)
      return new Response(JSON.stringify({ error: 'Invalid or expired recovery session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const userId = sessionRow.user_id as string
    const { error: userErr } = await supabase.auth.admin.updateUserById(userId, {
      password: String(newPassword),
    })

    if (userErr) throw userErr

    await supabase.from('recovery_password_sessions').delete().eq('id', sessionRow.id)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
