import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-support-message`

export type SendSupportMessageResult =
  | { ok: true }
  | { ok: false; error: string }

export async function sendSupportMessage(message: string): Promise<SendSupportMessageResult> {
  const trimmed = message.trim()
  if (trimmed.length < 10) {
    return { ok: false, error: 'Please enter at least 10 characters.' }
  }
  if (trimmed.length > 4000) {
    return { ok: false, error: 'Message is too long (maximum 4,000 characters).' }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return { ok: false, error: 'You must be signed in to send a message.' }
  }

  try {
    const resp = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ message: trimmed }),
    })

    const text = await resp.text()
    let data: { error?: string; success?: boolean } = {}
    try {
      data = text ? (JSON.parse(text) as typeof data) : {}
    } catch {
      return {
        ok: false,
        error: text.trim().slice(0, 200) || `Could not send message (${resp.status})`,
      }
    }

    if (!resp.ok || data.success !== true) {
      return { ok: false, error: data.error ?? 'Could not send message. Please try again.' }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Network error. Check your connection and try again.' }
  }
}
