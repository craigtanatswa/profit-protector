import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { notifyOwnerStaffSale, notifyOwnerStaffStockAdjustment, notifyOwnerStaffStockReceived } from '../lib/notifications'
import { mergeRemoteActivityLogIntoWatermelon, refreshOwnerProductsForRemoteSale } from '../lib/sync'
import { logStaffSaleNotify } from '../lib/staffSaleNotifyDebug'

import { FOREGROUND_INVENTORY_POLL_MS } from '../lib/syncPoll'

/**
 * Owner fast path: Realtime on `sales`, `products`, and `activity_logs`, plus foreground polling.
 * Staff sale INSERTs run **full sync** and show an in-app banner; Expo Push is sent
 * server-side from `shopkeeper-auth` `push_sale` so owners are notified when the app is closed.
 * Staff stock adjustments use `push_stock_adjustment` (server push + activity log) with the
 * same in-app banner via `activity_logs` Realtime when the publication is enabled.
 * Staff stock receives use `push_stock_received` with the same pattern.
 *
 * SQL: `sales_realtime_publication.sql`, `products_realtime_publication.sql`,
 * `activity_logs_realtime.sql`.
 */
export function useOwnerSalesRealtimeSync() {
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const user = useAuthStore((s) => s.user)
  const triggerSync = useAuthStore((s) => s.triggerSync)
  const channelSuffix = useRef(`${Math.random().toString(36).slice(2, 11)}`)

  useEffect(() => {
    if (!business?.id || activeRole !== 'owner' || !user) return undefined

    const businessId = business.id

    logStaffSaleNotify('owner.realtime.subscribe', { businessId })

    const channel = supabase
      .channel(`owner_inventory_${businessId}_${channelSuffix.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `business_id=eq.${businessId}`,
        },
        (payload: {
          eventType: string
          new: Record<string, unknown>
          old?: Record<string, unknown>
        }) => {
          if (payload.eventType === 'INSERT') {
            void (async () => {
              const saleId = String(payload.new.id ?? '')
              const sk = payload.new.created_by_shopkeeper_id
              const staffSale = sk != null && sk !== ''

              logStaffSaleNotify('owner.realtime.sales_insert', {
                saleId,
                staffSale,
                receipt: payload.new.receipt_number ?? null,
              })

              await Promise.all([
                triggerSync(businessId),
                staffSale
                  ? refreshOwnerProductsForRemoteSale(businessId, saleId).catch(() => {})
                  : Promise.resolve(),
              ])
              // In-app banner is delivered via activity_logs Realtime (sale_completed).
            })()
            return
          }

          void (async () => {
            await triggerSync(businessId)
          })()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          void (async () => {
            await triggerSync(businessId)
          })()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_logs',
          filter: `business_id=eq.${businessId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          void (async () => {
            const action = String(payload.new.action ?? '')
            logStaffSaleNotify('owner.realtime.activity_log_insert', {
              action,
              logId: payload.new.id ?? null,
              actorRole: payload.new.actor_role ?? null,
              entityName: payload.new.entity_name ?? null,
            })

            await mergeRemoteActivityLogIntoWatermelon(payload.new)
            void triggerSync(businessId)

            if (payload.new.actor_role !== 'shopkeeper') {
              logStaffSaleNotify('owner.realtime.activity_log_skip', {
                reason: 'not_shopkeeper',
                action,
              })
              return
            }

            const detailsRaw = payload.new.details
            const productName = String(payload.new.entity_name ?? 'product')
            const staffLabel =
              String(payload.new.actor_name ?? '').trim().length > 0
                ? String(payload.new.actor_name)
                : 'Staff'

            if (action === 'stock_adjusted') {
              let qtyChange = 0
              let unit: string | undefined
              if (detailsRaw != null && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)) {
                const d = detailsRaw as Record<string, unknown>
                qtyChange = Number(d.qtyChange)
                if (d.unit != null) unit = String(d.unit)
              }

              await notifyOwnerStaffStockAdjustment({
                businessId,
                staffLabel,
                productName,
                qtyChange: Number.isFinite(qtyChange) ? qtyChange : 0,
                unit,
              })
              return
            }

            if (action === 'stock_received') {
              let qty = 0
              let unit: string | undefined
              if (detailsRaw != null && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)) {
                const d = detailsRaw as Record<string, unknown>
                qty = Number(d.qty)
                if (d.unit != null) unit = String(d.unit)
              }

              await notifyOwnerStaffStockReceived({
                businessId,
                staffLabel,
                productName,
                qty: Number.isFinite(qty) ? qty : 0,
                unit,
              })
              return
            }

            if (action === 'sale_completed') {
              let totalCents: number | undefined
              let receiptNumber = String(payload.new.entity_name ?? '')
              if (detailsRaw != null && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)) {
                const d = detailsRaw as Record<string, unknown>
                if (d.totalCents != null) totalCents = Number(d.totalCents)
                if (d.receiptNumber != null) receiptNumber = String(d.receiptNumber)
              }
              const totalLabel =
                totalCents != null && Number.isFinite(totalCents)
                  ? `$${(totalCents / 100).toFixed(2)}`
                  : undefined

              logStaffSaleNotify('owner.realtime.sale_completed', {
                receiptNumber,
                staffLabel,
                totalLabel: totalLabel ?? null,
              })

              await notifyOwnerStaffSale({
                businessId,
                receiptNumber,
                staffLabel,
                totalLabel,
              })
              return
            }

            logStaffSaleNotify('owner.realtime.activity_log_unhandled', { action })
          })()
        },
      )
      .subscribe((status, err) => {
        logStaffSaleNotify('owner.realtime.channel_status', {
          status,
          error: err?.message ?? null,
        })
      })

    // Fallback poll — only fires when Realtime is silent and no sync is already
    // in progress. Prevents back-to-back queuing when syncAll takes >5 s.
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return
      if (useAuthStore.getState().syncStatus === 'syncing') return
      void triggerSync(businessId)
    }, FOREGROUND_INVENTORY_POLL_MS)

    return () => {
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [business?.id, activeRole, user?.id, triggerSync])
}
