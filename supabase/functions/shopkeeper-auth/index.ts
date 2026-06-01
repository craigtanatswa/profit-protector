import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendOwnerPushInternal } from '../_shared/owner_push.ts'

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

/** Postgres UUID columns reject "" — use null instead (matches owner sync). */
function nullableTextId(value: unknown, fallback?: unknown): string | null {
  const primary = value != null ? String(value).trim() : ''
  if (primary.length > 0) return primary
  if (fallback != null) {
    const fb = String(fallback).trim()
    if (fb.length > 0) return fb
  }
  return null
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
        .is('deleted_at', null)
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

      const token = await issueShopkeeperSession(
        supabase,
        shopkeeper.id,
        business.id,
        deviceId,
      )

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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', payload.shopkeeperId)
        .eq('device_id', payload.deviceId)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheck = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheck === 'superseded') return sessionSuperseded()

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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckProducts = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckProducts === 'superseded') return sessionSuperseded()

      // `since` enables incremental polling: only rows updated after this ISO timestamp are
      // returned. Callers pass this on background polls; omit it for a full authoritative pull.
      const sinceIso =
        typeof body.since === 'string' && body.since.length > 0 ? body.since : null

      let query = supabase
        .from('products')
        .select('*')
        .eq('business_id', bizId)

      if (sinceIso !== null) {
        query = query.gt('updated_at', sinceIso)
      }

      const { data: rows, error: prodErr } = await query

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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckSales = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckSales === 'superseded') return sessionSuperseded()

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
      console.log('[staff-sale-notify] server.push_sale.start', {
        hasActivityLog: body.activity_log != null,
      })

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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckPush = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckPush === 'superseded') return sessionSuperseded()

      const sale = body.sale as Record<string, unknown> | undefined
      const sale_items = body.sale_items as Record<string, unknown>[] | undefined
      if (!sale || sale_items == null || !Array.isArray(sale_items)) {
        return error('Missing sale payload.')
      }

      const canonicalShopkeeperId = String(shopkeeper.id ?? '').trim()
      const canonicalBizId = String(shopkeeper.business_id ?? '').trim()
      if (!canonicalShopkeeperId || !canonicalBizId) {
        return error('[push_sale:sales] shopkeeper record missing id or business_id')
      }

      const saleBusinessId = String(sale.business_id ?? '').trim()
      if (saleBusinessId !== canonicalBizId) return error('Invalid sale.')

      const saleId = String(sale.id ?? '').trim()
      if (!saleId) return error('[push_sale:sales] missing sale id')

      const row = {
        id: saleId,
        business_id: canonicalBizId,
        total_cents: Number(sale.total_cents),
        discount_cents: Number(sale.discount_cents),
        payment_method: String(sale.payment_method),
        receipt_number: String(sale.receipt_number),
        note:
          sale.note != null && String(sale.note).trim().length > 0
            ? String(sale.note).trim()
            : null,
        created_at: String(sale.created_at),
        // Must be set explicitly — a DB trigger fires on INSERT when this is NULL and reads
        // from a session context variable that returns "" in the service role context, which
        // fails the uuid cast. Passing the validated shopkeeper UUID avoids the trigger path.
        created_by_shopkeeper_id: canonicalShopkeeperId,
      }

      let { error: upSale } = await supabase.from('sales').upsert(row, {
        onConflict: 'id',
      })
      if (upSale) {
        console.warn('[staff-sale-notify] server.sales_upsert.error', {
          message: upSale.message,
          code: (upSale as Record<string, unknown>).code ?? null,
          details: (upSale as Record<string, unknown>).details ?? null,
          hint: (upSale as Record<string, unknown>).hint ?? null,
          rowId: row.id,
          rowIdLength: row.id.length,
        })
        return error(`[push_sale:sales] ${upSale.message}`)
      }

      const itemsPayload = sale_items.map((it) => ({
        id: String(it.id),
        sale_id: String(it.sale_id),
        product_id: String(it.product_id ?? '').trim(),
        product_name_snapshot: String(it.product_name_snapshot),
        qty: Number(it.qty),
        unit_price_cents: Number(it.unit_price_cents),
        cost_price_cents: Number(it.cost_price_cents),
      }))

      for (const it of itemsPayload) {
        if (!it.product_id) {
          return error('[push_sale:sale_items] line item missing product_id')
        }
      }

      const { error: upItems } = await supabase
        .from('sale_items')
        .upsert(itemsPayload, { onConflict: 'id' })
      if (upItems) return error(`[push_sale:sale_items] ${upItems.message}`)

      const movementsRaw = body.stock_movements as Record<string, unknown>[] | undefined
      if (Array.isArray(movementsRaw) && movementsRaw.length > 0) {
        const movRows = movementsRaw
          .map((m) => ({
            id: String(m.id ?? ''),
            business_id: canonicalBizId,
            product_id: String(m.product_id ?? ''),
            product_name_snapshot: String(m.product_name_snapshot ?? ''),
            action: String(m.action ?? 'sale'),
            qty_change: Number(m.qty_change),
            reason:
              m.reason == null || String(m.reason).length === 0 ? null : String(m.reason),
            supplier: m.supplier == null ? '' : String(m.supplier),
            created_at: String(m.created_at ?? row.created_at),
          }))
          .filter((r) => r.id.length > 0 && r.product_id.length > 0)

        if (movRows.length > 0) {
          const { error: movErr } = await supabase
            .from('stock_movements')
            .upsert(movRows, { onConflict: 'id' })
          if (movErr) return error(`[push_sale:stock_movements] ${movErr.message}`)
        }
      }

      const staffLabel =
        typeof shopkeeper.full_name === 'string' && shopkeeper.full_name.trim().length > 0
          ? shopkeeper.full_name.trim()
          : 'Staff'

      // Upsert activity log — triggers owner Realtime in-app banner (same path as stock events)
      const activityLogRaw = body.activity_log as Record<string, unknown> | undefined
      const activityLogId =
        activityLogRaw != null && String(activityLogRaw.id ?? '').length > 0
          ? String(activityLogRaw.id)
          : `${row.id}_log`

      const { data: existingActivityLog } = await supabase
        .from('activity_logs')
        .select('id')
        .eq('id', activityLogId)
        .maybeSingle()
      const isNewActivityLog = !existingActivityLog

      console.log('[staff-sale-notify] server.activity_log.prepare', {
        saleId: row.id,
        activityLogId,
        isNewActivityLog,
        hasClientActivityLog: activityLogRaw != null,
      })

      const detailsBase =
        activityLogRaw?.details != null &&
        typeof activityLogRaw.details === 'object' &&
        !Array.isArray(activityLogRaw.details)
          ? (activityLogRaw.details as Record<string, unknown>)
          : {
              totalCents: row.total_cents,
              itemCount: itemsPayload.length,
              paymentMethod: row.payment_method,
              receiptNumber: row.receipt_number,
            }
      const details = {
        ...detailsBase,
        staffName: staffLabel,
        saleId: row.id,
        receiptNumber: row.receipt_number,
      }

      const { error: logErr } = await supabase.from('activity_logs').upsert(
        {
          id: activityLogId,
          business_id: canonicalBizId,
          actor_id: canonicalShopkeeperId,
          actor_name: staffLabel,
          actor_role: 'shopkeeper',
          action: 'sale_completed',
          entity_type: 'sale',
          entity_id: nullableTextId(activityLogRaw?.entity_id, row.id),
          entity_name: String(activityLogRaw?.entity_name ?? row.receipt_number),
          details,
          created_at: String(activityLogRaw?.created_at ?? row.created_at),
        },
        { onConflict: 'id' },
      )
      if (logErr) {
        console.warn('[staff-sale-notify] server.activity_log.upsert_failed', {
          activityLogId,
          message: logErr.message,
        })
      } else {
        console.log('[staff-sale-notify] server.activity_log.upsert_ok', {
          activityLogId,
          isNewActivityLog,
        })
      }

      const { error: appliedErr } = await supabase
        .from('sale_inventory_applied')
        .insert({ sale_id: row.id })

      let stockAlreadyApplied = false
      if (appliedErr) {
        if (appliedErr.code === '23505') stockAlreadyApplied = true
        else return error(`[push_sale:sale_inventory_applied] ${appliedErr.message}`)
      }

      if (!stockAlreadyApplied) {
        for (const it of itemsPayload) {
          const qty = Number(it.qty)
          if (!Number.isFinite(qty) || qty <= 0) continue
          const pid = String(it.product_id)
          const { error: stockErr } = await supabase.rpc('decrement_product_stock_for_sale', {
            p_product_id: pid,
            p_business_id: canonicalBizId,
            p_qty: Math.floor(qty),
          })
          if (stockErr) return error(`[push_sale:decrement_stock] ${stockErr.message}`)
        }
      }

      // Notify owner on first activity log insert (matches stock events; avoids duplicate push on retry)
      if (isNewActivityLog && !logErr) {
        const receipt = row.receipt_number.trim() || 'Sale'
        const totalCents = Number(row.total_cents)
        const totalPart =
          Number.isFinite(totalCents) ? ` · $${(totalCents / 100).toFixed(2)}` : ''
        const title = '🛒 Staff Sale Recorded'
        const pushBody = `${staffLabel} completed ${receipt}${totalPart}`

        try {
          const pushResult = await sendOwnerPushInternal({
            businessId: canonicalBizId,
            title,
            body: pushBody,
            data: { type: 'staff_sale', screen: 'sales' },
            androidChannel: 'staff-sales',
          })
          console.log('[staff-sale-notify] server.owner_push.result', {
            saleId: row.id,
            ok: pushResult.ok,
            sent: pushResult.sent ?? 0,
          })
          if (!pushResult.ok || (pushResult.sent ?? 0) === 0) {
            console.warn('[staff-sale-notify] server.owner_push.not_delivered', pushResult)
          }
        } catch (pushErr) {
          console.warn('[staff-sale-notify] server.owner_push.failed', pushErr)
        }
      } else {
        console.log('[staff-sale-notify] server.owner_push.skipped', {
          saleId: row.id,
          isNewActivityLog,
          logErr: logErr?.message ?? null,
          stockAlreadyApplied,
        })
      }

      console.log('[staff-sale-notify] server.push_sale.done', { saleId: row.id })
      return json({ status: 'ok' })
    }

    if (action === 'patch_products') {
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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckPatch = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckPatch === 'superseded') return sessionSuperseded()

      const patchesRaw = body.patches
      if (!Array.isArray(patchesRaw) || patchesRaw.length === 0) {
        return error('Missing patches.')
      }

      for (const raw of patchesRaw) {
        const p = raw as Record<string, unknown>
        const productId = String(p.product_id ?? '')
        const stockQty = Number(p.stock_qty)
        const updatedAt =
          p.updated_at != null && String(p.updated_at).length > 0
            ? String(p.updated_at)
            : new Date().toISOString()

        if (!productId || !Number.isFinite(stockQty)) continue

        const updateRow: Record<string, unknown> = {
          stock_qty: Math.floor(stockQty),
          updated_at: updatedAt,
        }

        if (
          p.cost_price_cents !== undefined &&
          p.cost_price_cents !== null &&
          String(p.cost_price_cents) !== ''
        ) {
          const c = Number(p.cost_price_cents)
          if (Number.isFinite(c)) updateRow.cost_price_cents = Math.round(c)
        }

        const { error: upErr } = await supabase
          .from('products')
          .update(updateRow)
          .eq('id', productId)
          .eq('business_id', bizId)

        if (upErr) return error(upErr.message)
      }

      return json({ status: 'ok' })
    }

    if (action === 'push_stock_adjustment') {
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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckAdjust = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckAdjust === 'superseded') return sessionSuperseded()

      const productPatch = body.product_patch as Record<string, unknown> | undefined
      const movementRaw = body.stock_movement as Record<string, unknown> | undefined
      const activityRaw = body.activity_log as Record<string, unknown> | undefined

      if (!productPatch || !movementRaw || !activityRaw) {
        return error('Missing stock adjustment payload.')
      }

      const productId = String(productPatch.product_id ?? '')
      const stockQty = Number(productPatch.stock_qty)
      const updatedAt =
        productPatch.updated_at != null && String(productPatch.updated_at).length > 0
          ? String(productPatch.updated_at)
          : new Date().toISOString()

      if (!productId || !Number.isFinite(stockQty)) {
        return error('Invalid product patch.')
      }

      const movementId = String(movementRaw.id ?? '')
      const qtyChange = Number(movementRaw.qty_change)
      if (!movementId || !Number.isFinite(qtyChange)) {
        return error('Invalid stock movement.')
      }

      const activityId = String(activityRaw.id ?? '')
      if (!activityId) return error('Invalid activity log.')

      const { error: upErr } = await supabase
        .from('products')
        .update({
          stock_qty: Math.floor(stockQty),
          updated_at: updatedAt,
        })
        .eq('id', productId)
        .eq('business_id', bizId)
      if (upErr) return error(upErr.message)

      const movementRow = {
        id: movementId,
        business_id: bizId,
        product_id: productId,
        product_name_snapshot: String(movementRaw.product_name_snapshot ?? ''),
        action: 'adjustment',
        qty_change: qtyChange,
        reason:
          movementRaw.reason == null || String(movementRaw.reason).length === 0
            ? null
            : String(movementRaw.reason),
        supplier: movementRaw.supplier == null ? '' : String(movementRaw.supplier),
        created_at: String(movementRaw.created_at ?? updatedAt),
      }

      const { error: movErr } = await supabase
        .from('stock_movements')
        .upsert(movementRow, { onConflict: 'id' })
      if (movErr) return error(movErr.message)

      const staffName =
        typeof shopkeeper.full_name === 'string' && shopkeeper.full_name.trim().length > 0
          ? shopkeeper.full_name.trim()
          : 'Staff'

      const entityName = String(activityRaw.entity_name ?? movementRow.product_name_snapshot)
      const detailsRaw = activityRaw.details
      const baseDetails =
        detailsRaw != null && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)
          ? (detailsRaw as Record<string, unknown>)
          : { qtyChange, reason: movementRow.reason ?? '' }
      const details = { ...baseDetails, staffName }

      const { error: logErr } = await supabase.from('activity_logs').upsert(
        {
          id: activityId,
          business_id: bizId,
          actor_id: shopkeeperId,
          actor_name: staffName,
          actor_role: 'shopkeeper',
          action: 'stock_adjusted',
          entity_type: 'stock_movement',
          entity_id: String(activityRaw.entity_id ?? productId),
          entity_name: entityName,
          details,
          created_at: String(activityRaw.created_at ?? movementRow.created_at),
        },
        { onConflict: 'id' },
      )
      if (logErr) return error(logErr.message)

      const unit =
        details != null &&
        typeof details === 'object' &&
        'unit' in details &&
        String((details as Record<string, unknown>).unit ?? '').length > 0
          ? String((details as Record<string, unknown>).unit)
          : 'units'
      const qtyLabel =
        qtyChange > 0
          ? `+${qtyChange} ${unit}`
          : qtyChange < 0
            ? `−${Math.abs(qtyChange)} ${unit}`
            : `0 ${unit}`
      const productLabel = entityName.trim() || 'product'
      const title = qtyChange >= 0 ? '📦 Staff Stock Added' : '📦 Staff Stock Removed'
      const pushBody = `${staffName} adjusted ${productLabel} (${qtyLabel})`

      try {
        const pushResult = await sendOwnerPushInternal({
          businessId: bizId,
          title,
          body: pushBody,
          data: { type: 'staff_stock_adjustment', screen: 'activity_log', productId },
          androidChannel: 'staff-inventory',
        })
        if (!pushResult.ok || (pushResult.sent ?? 0) === 0) {
          console.warn(
            '[shopkeeper-auth] staff stock adjustment owner push not delivered',
            pushResult,
          )
        }
      } catch (pushErr) {
        console.warn('[shopkeeper-auth] staff stock adjustment push failed:', pushErr)
      }

      return json({ status: 'ok' })
    }

    if (action === 'push_stock_received') {
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
        .is('deleted_at', null)
        .single()

      if (!shopkeeper) return error('Account deactivated.')

      const { data: device } = await supabase
        .from('shopkeeper_devices')
        .select('is_approved')
        .eq('shopkeeper_id', shopkeeperId)
        .eq('device_id', deviceIdFromToken)
        .single()

      if (!device?.is_approved) return error('Device no longer approved.')

      const sessionCheckReceive = await assertActiveShopkeeperSession(supabase, payload)
      if (sessionCheckReceive === 'superseded') return sessionSuperseded()

      const productPatch = body.product_patch as Record<string, unknown> | undefined
      const movementRaw = body.stock_movement as Record<string, unknown> | undefined
      const activityRaw = body.activity_log as Record<string, unknown> | undefined

      if (!productPatch || !movementRaw || !activityRaw) {
        return error('Missing stock received payload.')
      }

      const productId = String(productPatch.product_id ?? '')
      const stockQty = Number(productPatch.stock_qty)
      const updatedAt =
        productPatch.updated_at != null && String(productPatch.updated_at).length > 0
          ? String(productPatch.updated_at)
          : new Date().toISOString()

      if (!productId || !Number.isFinite(stockQty)) {
        return error('Invalid product patch.')
      }

      const movementId = String(movementRaw.id ?? '')
      const qtyChange = Number(movementRaw.qty_change)
      if (!movementId || !Number.isFinite(qtyChange) || qtyChange <= 0) {
        return error('Invalid stock movement.')
      }

      const activityId = String(activityRaw.id ?? '')
      if (!activityId) return error('Invalid activity log.')

      const updateRow: Record<string, unknown> = {
        stock_qty: Math.floor(stockQty),
        updated_at: updatedAt,
      }
      if (
        productPatch.cost_price_cents !== undefined &&
        productPatch.cost_price_cents !== null &&
        String(productPatch.cost_price_cents) !== ''
      ) {
        const c = Number(productPatch.cost_price_cents)
        if (Number.isFinite(c)) updateRow.cost_price_cents = Math.round(c)
      }

      const { error: upErr } = await supabase
        .from('products')
        .update(updateRow)
        .eq('id', productId)
        .eq('business_id', bizId)
      if (upErr) return error(upErr.message)

      const movementRow = {
        id: movementId,
        business_id: bizId,
        product_id: productId,
        product_name_snapshot: String(movementRaw.product_name_snapshot ?? ''),
        action: 'purchase',
        qty_change: qtyChange,
        reason:
          movementRaw.reason == null || String(movementRaw.reason).length === 0
            ? null
            : String(movementRaw.reason),
        supplier: movementRaw.supplier == null ? '' : String(movementRaw.supplier),
        created_at: String(movementRaw.created_at ?? updatedAt),
      }

      const { error: movErr } = await supabase
        .from('stock_movements')
        .upsert(movementRow, { onConflict: 'id' })
      if (movErr) return error(movErr.message)

      const staffName =
        typeof shopkeeper.full_name === 'string' && shopkeeper.full_name.trim().length > 0
          ? shopkeeper.full_name.trim()
          : 'Staff'

      const entityName = String(activityRaw.entity_name ?? movementRow.product_name_snapshot)
      const detailsRaw = activityRaw.details
      const baseDetails =
        detailsRaw != null && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)
          ? (detailsRaw as Record<string, unknown>)
          : { qty: qtyChange }
      const details = { ...baseDetails, staffName }

      const { error: logErr } = await supabase.from('activity_logs').upsert(
        {
          id: activityId,
          business_id: bizId,
          actor_id: shopkeeperId,
          actor_name: staffName,
          actor_role: 'shopkeeper',
          action: 'stock_received',
          entity_type: 'stock_movement',
          entity_id: String(activityRaw.entity_id ?? productId),
          entity_name: entityName,
          details,
          created_at: String(activityRaw.created_at ?? movementRow.created_at),
        },
        { onConflict: 'id' },
      )
      if (logErr) return error(logErr.message)

      const unit =
        details != null &&
        typeof details === 'object' &&
        'unit' in details &&
        String((details as Record<string, unknown>).unit ?? '').length > 0
          ? String((details as Record<string, unknown>).unit)
          : 'units'
      const qtyLabel = `+${qtyChange} ${unit}`
      const productLabel = entityName.trim() || 'product'
      const title = '📦 Staff Stock Received'
      const pushBody = `${staffName} received ${qtyLabel} of ${productLabel}`

      try {
        const pushResult = await sendOwnerPushInternal({
          businessId: bizId,
          title,
          body: pushBody,
          data: { type: 'staff_stock_received', screen: 'activity_log', productId },
          androidChannel: 'staff-inventory',
        })
        if (!pushResult.ok || (pushResult.sent ?? 0) === 0) {
          console.warn(
            '[shopkeeper-auth] staff stock received owner push not delivered',
            pushResult,
          )
        }
      } catch (pushErr) {
        console.warn('[shopkeeper-auth] staff stock received push failed:', pushErr)
      }

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
        .is('deleted_at', null)
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
        .is('deleted_at', null)
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

      const token = await issueShopkeeperSession(
        supabase,
        shopkeeper.id,
        business.id,
        deviceId,
      )

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

type SupabaseAdmin = ReturnType<typeof createClient>

/** Upserts the single active session for this shopkeeper and returns a signed JWT. */
async function issueShopkeeperSession(
  supabase: SupabaseAdmin,
  shopkeeperId: string,
  businessId: string,
  deviceId: string,
): Promise<string> {
  const sessionId = crypto.randomUUID()
  const now = new Date().toISOString()

  const { error } = await supabase.from('shopkeeper_active_sessions').upsert(
    {
      shopkeeper_id: shopkeeperId,
      device_id: deviceId,
      session_id: sessionId,
      last_seen_at: now,
    },
    { onConflict: 'shopkeeper_id' },
  )

  if (error) {
    console.error(JSON.stringify({ tag: 'issue_shopkeeper_session', shopkeeperId, error: String(error) }))
    throw new Error('Failed to register active session')
  }

  return generateToken({ shopkeeperId, businessId, deviceId, sessionId })
}

/** Returns 'superseded' when this JWT is no longer the active session. */
async function assertActiveShopkeeperSession(
  supabase: SupabaseAdmin,
  payload: Record<string, unknown>,
): Promise<'ok' | 'superseded'> {
  const sessionId = payload.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) return 'superseded'

  const shopkeeperId = payload.shopkeeperId
  if (typeof shopkeeperId !== 'string' && typeof shopkeeperId !== 'number') return 'superseded'

  const { data, error } = await supabase
    .from('shopkeeper_active_sessions')
    .select('session_id')
    .eq('shopkeeper_id', shopkeeperId)
    .maybeSingle()

  if (error) {
    console.error(JSON.stringify({ tag: 'assert_shopkeeper_session', shopkeeperId, error: String(error) }))
    return 'superseded'
  }

  if (!data || data.session_id !== sessionId) return 'superseded'

  await supabase
    .from('shopkeeper_active_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('shopkeeper_id', shopkeeperId)

  return 'ok'
}

function sessionSuperseded(): Response {
  return new Response(
    JSON.stringify({
      status: 'session_superseded',
      message: 'Signed in on another device. Please log in again.',
    }),
    {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

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
    exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
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
