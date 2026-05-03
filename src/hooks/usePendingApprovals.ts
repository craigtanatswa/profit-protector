import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuthStore } from '../stores/authStore'
import type { DeviceApprovalRequest } from '../types'
import { logActivity } from '../lib/activityLogger'
import { supabase } from '../lib/supabase'

function fromRemote(row: Record<string, unknown>): DeviceApprovalRequest {
  return {
    id: String(row.id),
    shopkeeperId: String(row.shopkeeper_id),
    businessId: String(row.business_id),
    shopkeeperName: String(row.shopkeeper_name),
    deviceId: String(row.device_id),
    deviceName: String(row.device_name ?? 'Unknown device'),
    status: row.status === 'approved' || row.status === 'denied' ? row.status : 'pending',
    requestedAt: String(row.requested_at ?? new Date().toISOString()),
  }
}

export function usePendingApprovals(businessId: string) {
  const [pendingRequests, setPendingRequests] = useState<DeviceApprovalRequest[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const setStoreRequests = useAuthStore((s) => s.setPendingApprovalRequests)
  const user = useAuthStore((s) => s.user)
  /** Supabase reuses one Realtime channel per topic; two mounted hooks with the same name hit "cannot add … after subscribe()". */
  const channelTopicSuffix = useRef(`${Math.random().toString(36).slice(2, 12)}`)

  const fetchPending = useCallback(async () => {
    if (!businessId) {
      setPendingRequests([])
      setStoreRequests([])
      return
    }

    setIsLoading(true)
    const { data } = await supabase
      .from('device_approval_requests')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })

    const mapped = (data ?? []).map((row) => fromRemote(row as Record<string, unknown>))
    setPendingRequests(mapped)
    setStoreRequests(mapped)
    setIsLoading(false)
  }, [businessId, setStoreRequests])

  useEffect(() => {
    void fetchPending()
    if (!businessId) return undefined

    const interval = setInterval(() => {
      void fetchPending()
    }, 30000)

    const channel = supabase
      .channel(`approval_requests_${businessId}_${channelTopicSuffix.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_approval_requests',
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

  const approveDevice = useCallback(
    async (requestId: string) => {
      const request = pendingRequests.find((r) => r.id === requestId)
      if (!request) return

      await supabase
        .from('device_approval_requests')
        .update({
          status: 'approved',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', requestId)

      await supabase
        .from('shopkeeper_devices')
        .update({
          is_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: user?.id ?? null,
        })
        .eq('shopkeeper_id', request.shopkeeperId)
        .eq('device_id', request.deviceId)

      await logActivity({
        action: 'device_approved',
        entityType: 'device',
        entityId: request.deviceId,
        entityName: request.deviceName,
        details: { shopkeeperName: request.shopkeeperName },
      })

      const next = pendingRequests.filter((r) => r.id !== requestId)
      setPendingRequests(next)
      setStoreRequests(next)
    },
    [pendingRequests, setStoreRequests, user?.id],
  )

  const denyDevice = useCallback(
    async (requestId: string) => {
      const request = pendingRequests.find((r) => r.id === requestId)
      if (!request) return

      await supabase
        .from('device_approval_requests')
        .update({
          status: 'denied',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', requestId)

      await logActivity({
        action: 'device_denied',
        entityType: 'device',
        entityId: request.deviceId,
        entityName: request.deviceName,
        details: { shopkeeperName: request.shopkeeperName },
      })

      const next = pendingRequests.filter((r) => r.id !== requestId)
      setPendingRequests(next)
      setStoreRequests(next)
    },
    [pendingRequests, setStoreRequests, user?.id],
  )

  return {
    pendingRequests,
    isLoading,
    approveDevice,
    denyDevice,
    refetch: fetchPending,
  }
}
