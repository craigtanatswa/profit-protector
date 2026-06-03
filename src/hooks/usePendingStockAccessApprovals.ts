import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuthStore } from '../stores/authStore'
import type { StockAccessApprovalRequest, StockAccessType } from '../types'
import { logActivity } from '../lib/activityLogger'
import { supabase } from '../lib/supabase'

function parseAccessType(value: unknown): StockAccessType {
  const raw = String(value ?? '').toLowerCase()
  return raw === 'adjust' ? 'adjust' : 'receive'
}

function fromRemote(row: Record<string, unknown>): StockAccessApprovalRequest {
  return {
    id: String(row.id),
    shopkeeperId: String(row.shopkeeper_id),
    businessId: String(row.business_id),
    shopkeeperName: String(row.shopkeeper_name ?? ''),
    accessType: parseAccessType(row.access_type),
    status: row.status === 'approved' || row.status === 'denied' ? row.status : 'pending',
    requestedAt: String(row.requested_at ?? new Date().toISOString()),
  }
}

export function usePendingStockAccessApprovals(businessId: string) {
  const [pendingRequests, setPendingRequests] = useState<StockAccessApprovalRequest[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const user = useAuthStore((s) => s.user)
  const channelTopicSuffix = useRef(`${Math.random().toString(36).slice(2, 12)}`)

  const fetchPending = useCallback(async () => {
    if (!businessId) {
      setPendingRequests([])
      return
    }

    setIsLoading(true)
    const { data } = await supabase
      .from('stock_access_approval_requests')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })

    setPendingRequests((data ?? []).map((row) => fromRemote(row as Record<string, unknown>)))
    setIsLoading(false)
  }, [businessId])

  useEffect(() => {
    void fetchPending()
    if (!businessId) return undefined

    const interval = setInterval(() => {
      void fetchPending()
    }, 30_000)

    const channel = supabase
      .channel(`stock_access_requests_${businessId}_${channelTopicSuffix.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stock_access_approval_requests',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          void fetchPending()
        },
      )
      .subscribe()

    return () => {
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [businessId, fetchPending])

  const approveStockAccess = useCallback(
    async (requestId: string) => {
      const request = pendingRequests.find((r) => r.id === requestId)
      if (!request) return

      const grantedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      await supabase
        .from('stock_access_approval_requests')
        .update({
          status: 'approved',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
          access_granted_until: grantedUntil,
        })
        .eq('id', requestId)

      await logActivity({
        action: 'stock_access_approved',
        entityType: 'shopkeeper',
        entityId: request.shopkeeperId,
        entityName: request.shopkeeperName,
        details: { grantedUntil, accessType: request.accessType },
      })

      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
    },
    [pendingRequests, user?.id],
  )

  const denyStockAccess = useCallback(
    async (requestId: string) => {
      const request = pendingRequests.find((r) => r.id === requestId)
      if (!request) return

      await supabase
        .from('stock_access_approval_requests')
        .update({
          status: 'denied',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', requestId)

      await logActivity({
        action: 'stock_access_denied',
        entityType: 'shopkeeper',
        entityId: request.shopkeeperId,
        entityName: request.shopkeeperName,
        details: { accessType: request.accessType },
      })

      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
    },
    [pendingRequests, user?.id],
  )

  return {
    pendingRequests,
    isLoading,
    approveStockAccess,
    denyStockAccess,
    refetch: fetchPending,
  }
}
