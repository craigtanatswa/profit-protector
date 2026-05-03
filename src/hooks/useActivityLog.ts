import { Q } from '@nozbe/watermelondb'
import { useCallback, useEffect, useState } from 'react'

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

export function useActivityLog(businessId: string) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refetch = useCallback(async () => {
    if (!businessId || !database) {
      setLogs([])
      return
    }
    setIsLoading(true)
    const rows = await database
      .get<ActivityLogModel>('activity_logs')
      .query(Q.where('business_id', businessId), Q.sortBy('created_at', Q.desc))
      .fetch()
    setLogs(rows.map(mapLog))
    setIsLoading(false)
  }, [businessId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { logs, isLoading, refetch }
}
