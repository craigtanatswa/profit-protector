import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SESSION_SECRET = Deno.env.get('SHOPKEEPER_SESSION_SECRET')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      action,
      businessId,
      username,
      password,
      deviceId,
      deviceName,
      sessionToken,
    } = await req.json()

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
        shopkeeper,
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
