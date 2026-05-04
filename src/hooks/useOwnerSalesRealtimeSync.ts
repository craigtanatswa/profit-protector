import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { notifyOwnerStaffSale } from '../lib/notifications'
import { refreshOwnerProductsForRemoteSale } from '../lib/sync'

import { FOREGROUND_INVENTORY_POLL_MS } from '../lib/syncPoll'

/**
 * Owner fast path: Realtime on `sales` + `products`, plus foreground polling.
 * Staff sale INSERTs run **full sync** and **line-item product refresh in parallel** (same
 * urgency as pulling the sale): sync reconciles sales/items locally while refresh retries
 * until `sale_items` and post-decrement `products` rows are visible — mirroring how sales
 * appear as soon as the row exists, not only after a slow sequential pipeline.
 *
 * SQL: `sales_realtime_publication.sql`, `products_realtime_publication.sql`.
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

              await Promise.all([
                triggerSync(businessId),
                staffSale
                  ? refreshOwnerProductsForRemoteSale(businessId, saleId).catch(() => {})
                  : Promise.resolve(),
              ])

              if (!staffSale) return

              const receiptNumber = String(payload.new.receipt_number ?? '')
              const totalCents = Number(payload.new.total_cents)
              const totalLabel =
                Number.isFinite(totalCents) ? `$${(totalCents / 100).toFixed(2)}` : undefined

              let staffLabel = 'Staff'
              const { data } = await supabase
                .from('shopkeepers')
                .select('full_name')
                .eq('id', String(sk))
                .maybeSingle()
              if (data?.full_name) staffLabel = String(data.full_name)

              await notifyOwnerStaffSale({
                receiptNumber,
                staffLabel,
                totalLabel,
              })
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
      .subscribe()

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
