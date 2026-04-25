import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
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
    const { email, userId, purpose } = await req.json()

    if (!email || !userId || !purpose) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

    // Invalidate any existing unused OTPs for this user+email
    await supabase
      .from('email_verifications')
      .update({ used: true })
      .eq('user_id', userId)
      .eq('email', email)
      .eq('used', false)

    // Store the new OTP
    const { error: insertError } = await supabase
      .from('email_verifications')
      .insert({
        user_id: userId,
        email,
        otp_code: otp,
        expires_at: expiresAt,
        used: false,
      })

    if (insertError) throw insertError

    // Send email via Resend
    const purposeLabels: Record<string, string> = {
      add_email: 'verify your email address',
      change_password: 'confirm your password change',
      recovery: 'recover your account',
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Profit Protector <noreply@profitprotector.app>',
        to: [email],
        subject: 'Profit Protector — Your verification code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #0047AB; margin-bottom: 8px;">Profit Protector</h2>
            <p style="color: #5A6A8A; margin-bottom: 24px;">
              Your verification code to ${purposeLabels[purpose] ?? 'verify your identity'}:
            </p>
            <div style="background: #E6EEFF; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0047AB;">
                ${otp}
              </span>
            </div>
            <p style="color: #5A6A8A; font-size: 13px;">
              This code expires in <strong>10 minutes</strong>.<br/>
              Do not share this code with anyone.
            </p>
            <p style="color: #DDE3F0; font-size: 11px; margin-top: 24px;">
              If you did not request this code, you can safely ignore this email.
            </p>
          </div>
        `,
      }),
    })

    if (!res.ok) {
      const resendError = await res.json()
      throw new Error(`Resend error: ${JSON.stringify(resendError)}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  }
})