import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return jsonResponse(
      {
        error:
          userErr?.message ??
          'Invalid or expired session. Sign out and sign in again, then retry.',
      },
      401,
    )
  }

  const userId = userData.user.id

  const { error: rpcError } = await admin.rpc('delete_account_data_for_user', {
    p_user_id: userId,
  })

  if (rpcError) {
    return jsonResponse(
      {
        error:
          rpcError.message ??
          'Could not remove account data. Run supabase/sql/account_lifecycle.sql (including delete_account_data_for_user) in the SQL Editor, redeploy this function, and retry.',
      },
      400,
    )
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId)
  if (delErr) {
    return jsonResponse(
      {
        error:
          delErr.message ??
          'Data was removed but the login could not be deleted. Please contact support.',
      },
      500,
    )
  }

  return jsonResponse({ ok: true })
})
