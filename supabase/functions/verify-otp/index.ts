import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse } from '../_shared/cors.ts'
import { buildSupabaseEmailFromPhone } from '../_shared/auth_email.ts'
import { decodeJwtPayload, isAuthenticatedUserJwt } from '../_shared/jwt_decode.ts'
import { preludeCheckVerificationCode } from '../_shared/prelude.ts'
import { normalizeZimbabwePhone } from '../_shared/phone.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const PRELUDE_API_KEY = Deno.env.get('PRELUDE_API_KEY')

/** Local 10-digit form stored in businesses.phone / app_users.phone */
function toPhone10(e164: string): string | null {
  const n = normalizeZimbabwePhone(e164)
  if (!n || !n.startsWith('+263')) return null
  const digits = n.slice(4)
  if (digits.length !== 9) return null
  return `0${digits}`
}

function invalidCode(msg = 'Invalid or expired code.'): Response {
  return jsonResponse({ success: false, error: msg }, 400)
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

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRELUDE_API_KEY) {
    return jsonResponse({ error: 'Server misconfiguration' }, 500)
  }

  try {
    const body = await req.json() as {
      phone?: string
      code?: string
      otp?: string
      password?: string
    }

    const normalized = normalizeZimbabwePhone(String(body.phone ?? ''))
    const codeRaw = String(body.code ?? body.otp ?? '').trim()
    const password =
      typeof body.password === 'string' ? body.password : ''

    if (!normalized || !/^[0-9]{4,8}$/.test(codeRaw)) {
      return jsonResponse(
        { success: false, error: 'Invalid phone or code format.' },
        400,
      )
    }

    const check = await preludeCheckVerificationCode(
      normalized,
      codeRaw,
      PRELUDE_API_KEY,
    )
    if (!check.ok) {
      return invalidCode(check.detail)
    }

    const authHeader = req.headers.get('Authorization')
    let bearerToken: string | null = null
    if (authHeader?.startsWith('Bearer ')) {
      bearerToken = authHeader.slice(7).trim()
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    /** --- Signup: password provided → create Auth user + app_users --- */
    if (password.length > 0) {
      if (password.length < 6 || password.length > 128) {
        return jsonResponse(
          { success: false, error: 'Password must be between 6 and 128 characters.' },
          400,
        )
      }

      const phone10 = toPhone10(normalized)
      if (!phone10) {
        return jsonResponse({ success: false, error: 'Invalid phone normalization.' }, 400)
      }

      const email = buildSupabaseEmailFromPhone(phone10)

      const { data: existing } = await supabase
        .from('app_users')
        .select('id')
        .eq('phone', phone10)
        .maybeSingle()

      if (existing?.id) {
        return jsonResponse(
          {
            success: false,
            error: 'An account with this phone number already exists. Please log in.',
          },
          409,
        )
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        phone: normalized,
        phone_confirm: true,
        user_metadata: { phone_local: phone10 },
      })

      if (createErr || !created?.user?.id) {
        const msg = createErr?.message ?? 'Could not create account'
        if (/already|registered|exists/i.test(msg)) {
          return jsonResponse(
            {
              success: false,
              error: 'An account with this phone number already exists. Please log in.',
            },
            409,
          )
        }
        console.error(JSON.stringify({ tag: 'verify_otp_create_user', message: msg }))
        return jsonResponse({ success: false, error: 'Could not create account.' }, 500)
      }

      const uid = created.user!.id

      const { error: insAu } = await supabase.from('app_users').insert({
        id: uid,
        phone: phone10,
        phone_verified: true,
        password_hash: null,
      })

      if (insAu) {
        console.error(JSON.stringify({ tag: 'verify_otp_app_users_insert', message: insAu.message }))
        await supabase.auth.admin.deleteUser(uid)
        return jsonResponse(
          { success: false, error: 'Could not finalize signup. Try again.' },
          500,
        )
      }

      return jsonResponse({
        success: true,
        signupComplete: true,
        phoneVerified: true,
      })
    }

    /** --- Existing session: confirm phone on Supabase Auth user --- */
    if (bearerToken) {
      const payload = decodeJwtPayload(bearerToken)
      if (!isAuthenticatedUserJwt(payload)) {
        return invalidCode()
      }

      const { error: adminErr } = await supabase.auth.admin.updateUserById(payload.sub, {
        phone: normalized,
        phone_confirm: true,
      })

      if (adminErr) {
        console.error(
          JSON.stringify({ tag: 'verify_otp_auth_update_failed', message: adminErr.message }),
        )
        return jsonResponse({ success: false, error: 'Could not update phone.' }, 500)
      }

      const phone10 = toPhone10(normalized)
      if (phone10) {
        await supabase
          .from('app_users')
          .update({ phone: phone10, phone_verified: true })
          .eq('id', payload.sub)
      }

      return jsonResponse({
        success: true,
        phoneVerified: true,
        signupComplete: false,
      })
    }

    return jsonResponse(
      {
        success: false,
        error: 'Password is required to create a new account.',
      },
      400,
    )
  } catch (e) {
    console.error(JSON.stringify({ tag: 'verify_otp_error', message: String(e) }))
    return jsonResponse({ success: false, error: 'Unexpected error' }, 500)
  }
})
