import { Q } from '@nozbe/watermelondb'
import { useCallback, useEffect, useRef, useState } from 'react'

import { database } from '../database'
import ActivityLogModel from '../database/models/ActivityLog'
import type { ActivityLog, UserRole } from '../types'

function mapLog(log: ActivityLogModel): ActivityLog {
  let details: Record<string, unknown> | undefined
  if (log.details) {
    try {
      details = JSON.parse(log.details) as Record<string, unknown>
    } catch {
      details = undefined
    }
  }

  return {
    id: log.id,
    businessId: log.businessId,
    actorId: log.actorId,
    actorName: log.actorName,
    actorRole: log.actorRole as UserRole,
    action: log.action as ActivityLog['action'],
    entityType: log.entityType as ActivityLog['entityType'],
    entityId: log.entityId ?? undefined,
    entityName: log.entityName ?? undefined,
    details,
    createdAt: log.createdAt.getTime(),
  }
}

/**
 * Live subscription to activity_logs — updates when sync or Realtime merges new rows.
 */
export function useActivityLog(businessId: string) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const prevBusinessIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!businessId || !database) {
      setLogs([])
      setIsLoading(false)
      prevBusinessIdRef.current = undefined
      return
    }

    const businessChanged = prevBusinessIdRef.current !== businessId
    prevBusinessIdRef.current = businessId
    if (businessChanged) setIsLoading(true)

    const subscription = database
      .get<ActivityLogModel>('activity_logs')
      .query(Q.where('business_id', businessId), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe({
        next: (records) => {
          setLogs(records.map(mapLog))
          setIsLoading(false)
        },
        error: () => {
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId])

  const refetch = useCallback(() => {
    /* observe() handles updates; kept for call-site compatibility */
  }, [])

  return { logs, isLoading, refetch }
}
