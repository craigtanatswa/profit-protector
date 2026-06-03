import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPPORT_INBOX_EMAIL =
  Deno.env.get('SUPPORT_INBOX_EMAIL') ?? 'cmudirira@gmail.com'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

  if (!RESEND_API_KEY) {
    return jsonResponse({ error: 'Email service is not configured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization' }, 401)
  }

  let body: { message?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < 10) {
    return jsonResponse({ error: 'Message must be at least 10 characters' }, 400)
  }
  if (message.length > 4000) {
    return jsonResponse({ error: 'Message is too long' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401)
  }

  const userId = userData.user.id

  const { data: business, error: bizErr } = await admin
    .from('businesses')
    .select('name, owner_name, business_type')
    .eq('user_id', userId)
    .maybeSingle()

  if (bizErr) {
    console.error(JSON.stringify({ tag: 'support_message_business', userId, error: String(bizErr) }))
    return jsonResponse({ error: 'Could not load business profile' }, 500)
  }

  if (!business) {
    console.warn(JSON.stringify({ tag: 'support_message_business_missing', userId }))
  }

  const ownerName = business?.owner_name?.trim() || 'Unknown'
  const businessName = business?.name?.trim() || 'Unknown business'
  const businessType = business?.business_type?.trim() || 'Unknown'

  const subject = `Profit Protector support — ${businessName}`
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0047AB; margin-bottom: 16px;">New support message</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0; color: #5A6A8A; width: 140px;">User name</td>
          <td style="padding: 8px 0; color: #0D1B3E; font-weight: 600;">${escapeHtml(ownerName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #5A6A8A;">Business name</td>
          <td style="padding: 8px 0; color: #0D1B3E; font-weight: 600;">${escapeHtml(businessName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #5A6A8A;">Business type</td>
          <td style="padding: 8px 0; color: #0D1B3E; font-weight: 600;">${escapeHtml(businessType)}</td>
        </tr>
      </table>
      <p style="color: #5A6A8A; margin-bottom: 8px;">Message</p>
      <div style="background: #F4F6FB; border-radius: 12px; padding: 16px; color: #0D1B3E; white-space: pre-wrap;">
        ${escapeHtml(message)}
      </div>
      <p style="color: #DDE3F0; font-size: 11px; margin-top: 24px;">
        Sent from Profit Protector app · User ID ${escapeHtml(userId)}
      </p>
    </div>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Profit Protector <noreply@profitprotector.app>',
      to: [SUPPORT_INBOX_EMAIL],
      reply_to: userData.user.email ?? undefined,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const resendError = await res.text()
    console.error(JSON.stringify({ tag: 'support_message_resend', userId, error: resendError }))
    return jsonResponse({ error: 'Could not send message' }, 500)
  }

  return jsonResponse({ success: true })
})
