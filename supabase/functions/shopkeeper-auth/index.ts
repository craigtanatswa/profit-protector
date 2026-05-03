import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SESSION_SECRET = Deno.env.get('SHOPKEEPER_SESSION_SECRET')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function monthWindowValid(startIso: string, endIso: string): boolean {
  const a = Date.parse(startIso)
  const b = Date.parse(endIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (b < a) return false
  if (b - a > 40 * 86400000) return false
  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '')
    const businessId =
      typeof body.businessId === 'string' ? body.businessId : undefined
    const username =
      typeof body.username === 'string' ? body.username : undefined
    const password = body.password
    const deviceId =
      typeof body.deviceId === 'string' ? body.deviceId : undefined
    const deviceName =
      typeof body.deviceName === 'string' ? body.deviceName : undefined
    const sessionToken =
      typeof body.sessionToken === 'string' ? body.sessionToken : undefined

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    if (action === 'login') {
      const { data: business } = await supabase
        .from('businesses')
        .select('id, name, public_id')
        .or(`id.eq.${businessId},public_id.eq.${businessId}`)
        .single()

      if (!business) {
        return error('Business ID not found. Check the ID and try again.')
      }

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('business_id', business.id)
        .eq('username', String(username).toLowerCase().trim())
        .eq('is_active', true)
        .single()

      if (!shopkeeper) {
        return error('Incorrect username or password.')
      }

      const hash = await hashPassword(String(password ?? ''))
      if (hash !== shopkeeper.password_hash) {
        return error('Incorrect username or password.')
      }

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('*')
        .eq('shopkeeper_id', shopkeeper.id)
        .eq('device_id', deviceId)
        .single()

      if (!device) {
        await supabase.from('device_approval_requests').insert({
          shopkeeper_id: shopkeeper.id,
          business_id: business.id,
          shopkeeper_name: shopkeeper.full_name,
          device_id: deviceId,
          device_name: deviceName,
          status: 'pending',
        })

        await supabase.from('shopkeeper_devices').insert({
          shopkeeper_id: shopkeeper.id,
          business_id: business.id,
          device_id: deviceId,
          device_name: deviceName,
          is_approved: false,
        })

        return json({
          status: 'pending_approval',
          shopkeeperName: shopkeeper.full_name,
          businessName: business.name,
          message: 'Approval request sent to the business owner. You will be notified once approved.',
        })
      }

      if (!device.is_approved) {
        const { data: request } = await supabase
          .from('device_approval_requests')
          .select('status')
          .eq('shopkeeper_id', shopkeeper.id)
          .eq('device_id', deviceId)
          .order('requested_at', { ascending: false })
          .limit(1)
          .single()

        if (request?.status === 'denied') {
          return error('Your login request was denied by the business owner. Please contact them for assistance.')
        }

        return json({
          status: 'pending_approval',
          shopkeeperName: shopkeeper.full_name,
          businessName: business.name,
          message: 'Waiting for owner approval. Please try again shortly.',
        })
      }

      await supabase
        .from('shopkeeper_devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('shopkeeper_id', shopkeeper.id)
        .eq('device_id', deviceId)

      const token = await generateToken({
        shopkeeperId: shopkeeper.id,
        businessId: business.id,
        deviceId,
      })

      return json({
        status: 'approved',
        sessionToken: token,
        shopkeeper: {
          id: shopkeeper.id,
          businessId: shopkeeper.business_id,
          username: shopkeeper.username,
          fullName: shopkeeper.full_name,
          phone: shopkeeper.phone,
          receiptSuffix: String(shopkeeper.receipt_suffix ?? '')
            .trim()
            .toUpperCase(),
        },
        businessId: business.id,
        businessName: business.name,
      })
    }

    if (action === 'verify_token') {
      const payload = await verifyToken(sessionToken)
      if (!payload) {
        return error('Session expired. Please log in again.')
      }

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('id', payload.shopkeeperId)
        .eq('is_active', true)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', payload.shopkeeperId)
        .eq('device_id', payload.deviceId)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      return json({
        status: 'valid',
        businessId: shopkeeper.business_id,
        shopkeeper: {
          id: shopkeeper.id,
          businessId: shopkeeper.business_id,
          username: shopkeeper.username,
          fullName: shopkeeper.full_name,
          phone: shopkeeper.phone,
          receiptSuffix: String(shopkeeper.receipt_suffix ?? '')
            .trim()
            .toUpperCase(),
        },
      })
    }

    if (action === 'pull_products') {
      const payload = await verifyToken(sessionToken)
      if (!payload) {
        return error('Session expired. Please log in again.')
      }

      const shopkeeperId = String(payload.shopkeeperId)
      const bizId = String(payload.businessId)
      const deviceIdFromToken = String(payload.deviceId)

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('id', shopkeeperId)
        .eq('is_active', true)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const { data: rows, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', bizId)

      if (prodErr) return error(prodErr.message)

      return json({ status: 'ok', products: rows ?? [] })
    }

    if (action === 'pull_sales_month') {
      const payload = await verifyToken(sessionToken)
      if (!payload) {
        return error('Session expired. Please log in again.')
      }

      const shopkeeperId = String(payload.shopkeeperId)
      const bizId = String(payload.businessId)
      const deviceIdFromToken = String(payload.deviceId)

      const monthStartIso = String(body.monthStartIso ?? '')
      const monthEndIso = String(body.monthEndIso ?? '')
      if (!monthWindowValid(monthStartIso, monthEndIso)) {
        return error('Invalid month range.')
      }

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('id', shopkeeperId)
        .eq('is_active', true)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const { data: saleRows, error: salesErr } = await supabase
        .from('sales')
        .select('*')
        .eq('business_id', bizId)
        .eq('created_by_shopkeeper_id', shopkeeperId)
        .gte('created_at', monthStartIso)
        .lte('created_at', monthEndIso)
        .order('created_at', { ascending: true })

      if (salesErr) return error(salesErr.message)

      const ids = (saleRows ?? []).map((r: { id: string }) => r.id)
      let itemRows: unknown[] = []
      if (ids.length > 0) {
        const { data: items, error: itemErr } = await supabase
          .from('sale_items')
          .select('*')
          .in('sale_id', ids)
        if (itemErr) return error(itemErr.message)
        itemRows = items ?? []
      }

      return json({
        status: 'ok',
        sales: saleRows ?? [],
        sale_items: itemRows,
      })
    }

    if (action === 'push_sale') {
      const payload = await verifyToken(sessionToken)
      if (!payload) {
        return error('Session expired. Please log in again.')
      }

      const shopkeeperId = String(payload.shopkeeperId)
      const bizId = String(payload.businessId)
      const deviceIdFromToken = String(payload.deviceId)

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('id', shopkeeperId)
        .eq('is_active', true)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sale = body.sale as Record<string, unknown> | undefined
      const sale_items = body.sale_items as Record<string, unknown>[] | undefined
      if (!sale || sale_items == null || !Array.isArray(sale_items)) {
        return error('Missing sale payload.')
      }

      if (String(sale.business_id) !== bizId) return error('Invalid sale.')

      const row = {
        id: String(sale.id),
        business_id: bizId,
        total_cents: Number(sale.total_cents),
        discount_cents: Number(sale.discount_cents),
        payment_method: String(sale.payment_method),
        receipt_number: String(sale.receipt_number),
        note: sale.note == null ? null : String(sale.note),
        created_at: String(sale.created_at),
        created_by_shopkeeper_id: shopkeeperId,
      }

      const { error: upSale } = await supabase.from('sales').upsert(row, {
        onConflict: 'id',
      })
      if (upSale) return error(upSale.message)

      const itemsPayload = sale_items.map((it) => ({
        id: String(it.id),
        sale_id: String(it.sale_id),
        product_id: String(it.product_id),
        product_name_snapshot: String(it.product_name_snapshot),
        qty: Number(it.qty),
        unit_price_cents: Number(it.unit_price_cents),
        cost_price_cents: Number(it.cost_price_cents),
      }))

      const { error: upItems } = await supabase
        .from('sale_items')
        .upsert(itemsPayload, { onConflict: 'id' })
      if (upItems) return error(upItems.message)

      return json({ status: 'ok' })
    }

    if (action === 'check_approval_status') {
      const { data: business } = await supabase
        .from('businesses')
        .select('id, public_id')
        .or(`id.eq.${businessId},public_id.eq.${businessId}`)
        .single()

      if (!business) return json({ status: 'pending' })

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('id')
        .eq('business_id', business.id)
        .eq('username', String(username).toLowerCase().trim())
        .single()

      if (!shopkeeper) return json({ status: 'pending' })

      const { data: request } = await supabase
        .from('device_approval_requests')
        .select('status')
        .eq('shopkeeper_id', shopkeeper.id)
        .eq('device_id', deviceId)
        .order('requested_at', { ascending: false })
        .limit(1)
        .single()

      return json({ status: request?.status ?? 'pending' })
    }

    /** Issue a session after the owner approved this device — same trust as login without resending password. */
    if (action === 'resume_after_approval') {
      if (!businessId || !username || !deviceId) {
        return error('Missing business ID, username, or device ID.')
      }

      const { data: business } = await supabase
        .from('businesses')
        .select('id, name, public_id')
        .or(`id.eq.${businessId},public_id.eq.${businessId}`)
        .single()

      if (!business) {
        return error('Business not found.')
      }

      const { data: shopkeeper } = await supabase
        .from('shopkeepers')
        .select('*')
        .eq('business_id', business.id)
        .eq('username', String(username).toLowerCase().trim())
        .eq('is_active', true)
        .single()

      if (!shopkeeper) {
        return error('Account not found.')
      }

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeper.id)
        .eq('device_id', deviceId)
        .maybeSingle()

      if (!device?.is_approved) {
        return json({
          status: 'pending_approval',
          message: 'This device is not approved yet.',
        })
      }

      await supabase
        .from('shopkeeper_devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('shopkeeper_id', shopkeeper.id)
        .eq('device_id', deviceId)

      const token = await generateToken({
        shopkeeperId: shopkeeper.id,
        businessId: business.id,
        deviceId,
      })

      return json({
        status: 'approved',
        sessionToken: token,
        shopkeeper: {
          id: shopkeeper.id,
          businessId: shopkeeper.business_id,
          username: shopkeeper.username,
          fullName: shopkeeper.full_name,
          phone: shopkeeper.phone,
          receiptSuffix: String(shopkeeper.receipt_suffix ?? '')
            .trim()
            .toUpperCase(),
        },
        businessId: business.id,
        businessName: business.name,
      })
    }

    return error('Unknown action')
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Unexpected error')
  }
})

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'pp_shopkeeper_salt_2025')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateToken(payload: object): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({
    ...payload,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    iat: Date.now(),
  }))
  const signature = await signHmac(`${header}.${body}`, SESSION_SECRET)
  return `${header}.${body}.${signature}`
}

async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, sig] = token.split('.')
    const expectedSig = await signHmac(`${header}.${body}`, SESSION_SECRET)
    if (sig !== expectedSig) return null
    const payload = JSON.parse(atob(body))
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

async function signHmac(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

function json(data: object) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function error(message: string) {
  return new Response(JSON.stringify({ status: 'error', message }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
