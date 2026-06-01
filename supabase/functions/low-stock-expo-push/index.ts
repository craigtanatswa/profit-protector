import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const LOW_STOCK_INTERNAL_SECRET = Deno.env.get('LOW_STOCK_INTERNAL_SECRET')

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type JsonBody = {
  business_id?: string
  product_id?: string
  title?: string
  body?: string
  data?: Record<string, string | undefined>
  exclude_expo_push_token?: string | null
}

function normalizeData(
  data: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data) return out
  for (const [k, v] of Object.entries(data)) {
    if (v != null) out[k] = v
  }
  return out
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
  if (!businessId) {
    return jsonResponse({ error: 'Missing business_id' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const internalHeader = req.headers.get('x-low-stock-internal-secret')?.trim()
  const isInternal =
    internalHeader != null &&
    internalHeader.length > 0 &&
    LOW_STOCK_INTERNAL_SECRET != null &&
    internalHeader === LOW_STOCK_INTERNAL_SECRET

  if (!isInternal) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return jsonResponse({ error: 'Missing Authorization' }, 401)
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
    const uid = userData.user.id
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('user_id', uid)
      .maybeSingle()

    if (bizErr || !biz) {
      return jsonResponse({ error: 'Business not found or access denied' }, 403)
    }
  }

  const { data: businessRow, error: businessErr } = await admin
    .from('businesses')
    .select('user_id')
    .eq('id', businessId)
    .maybeSingle()

  if (businessErr || !businessRow?.user_id) {
    return jsonResponse({ error: 'Business not found' }, 404)
  }

  const ownerUserId = businessRow.user_id as string

  let title = payload.title?.trim()
  let pushBody = payload.body?.trim()
  let data = normalizeData(payload.data)

  const productId = payload.product_id?.trim()

  if ((!title || !pushBody) && productId) {
    const { data: product, error: productErr } = await admin
      .from('products')
      .select('id, name, stock_qty, unit, low_stock_threshold')
      .eq('id', productId)
      .eq('business_id', businessId)
      .maybeSingle()

    if (productErr || !product) {
      return jsonResponse({ error: 'Product not found' }, 404)
    }

    const name = String(product.name ?? 'Product')
    const unit = String(product.unit ?? '')
    const stock = Number(product.stock_qty)
    const threshold = Number(product.low_stock_threshold)
    const isOut = stock <= 0

    if (!title) {
      title = isOut ? '🚨 Out of Stock!' : '⚠️ Low Stock Alert'
    }
    if (!pushBody) {
      pushBody = isOut
        ? `${name} is out of stock. Tap to reorder now.`
        : `${name} has only ${stock} ${unit} left (threshold: ${threshold}). Time to reorder!`
    }
    if (Object.keys(data).length === 0) {
      data = {
        productId,
        type: isOut ? 'out_of_stock' : 'low_stock',
        screen: 'product_detail',
      }
    }
  }

  if (!title || !pushBody) {
    return jsonResponse(
      {
        error:
          'Provide title and body, or product_id to build the message server-side',
      },
      400,
    )
  }

  const { data: tokenRows, error: tokErr } = await admin
    .from('owner_expo_push_tokens')
    .select('expo_push_token')
    .eq('user_id', ownerUserId)

  if (tokErr) {
    return jsonResponse({ error: tokErr.message }, 500)
  }

  const exclude = payload.exclude_expo_push_token?.trim()
  const tokens = (tokenRows ?? [])
    .map((r) => r.expo_push_token as string)
    .filter((t) => t && t !== exclude)

  if (tokens.length === 0) {
    return jsonResponse({ ok: true, sent: 0 })
  }

  const isOut = (data.type ?? '') === 'out_of_stock'
  const androidChannel = isOut ? 'out-of-stock' : 'low-stock'

  const chunkSize = 90
  let sentOk = 0
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const slice = tokens.slice(i, i + chunkSize)
    const messages = slice.map((to) => ({
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
        'Content-Type': 'application/json',
      },
      // Expo push endpoint expects an array of messages, not { messages: [...] }.
      body: JSON.stringify(messages),
    })

    if (!expoRes.ok) {
      const errText = await expoRes.text()
      console.error('[low-stock-expo-push] Expo error:', expoRes.status, errText)
      return jsonResponse(
        { error: 'Expo push failed', detail: errText.slice(0, 200) },
        502,
      )
    }

    const expoJson = (await expoRes.json()) as {
      data?: Array<{ status?: string }>
    }
    const results = Array.isArray(expoJson.data) ? expoJson.data : []
    sentOk += results.filter((r) => r?.status === 'ok').length
  }

  return jsonResponse({ ok: true, sent: sentOk })
})
