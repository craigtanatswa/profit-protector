import * as Crypto from 'expo-crypto'

import { database } from '../database'
import type ActivityLogModel from '../database/models/ActivityLog'
import { useAuthStore } from '../stores/authStore'
import type { ActivityAction, EntityType } from '../types'
import { supabase } from './supabase'

export async function logActivity(params: {
  action: ActivityAction
  entityType: EntityType
  entityId?: string
  entityName?: string
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    const { business, activeRole, shopkeeperSession } = useAuthStore.getState()
    if (!business) return

    const isShopkeeper = activeRole === 'shopkeeper'
    const actorId = isShopkeeper
      ? shopkeeperSession?.shopkeeper.id ?? 'unknown'
      : business.id
    const actorName = isShopkeeper
      ? shopkeeperSession?.shopkeeper.fullName ?? 'Staff'
      : business.ownerName

    const logId = Crypto.randomUUID()
    const now = Date.now()
    const details = params.details ? JSON.stringify(params.details) : ''

    if (database) {
      const db = database
      await db.write(async () => {
        await db.get<ActivityLogModel>('activity_logs').create((log) => {
          log._raw.id = logId
          log.businessId = business.id
          log.actorId = actorId
          log.actorName = actorName
          log.actorRole = activeRole
          log.action = params.action
          log.entityType = params.entityType
          log.entityId = params.entityId ?? ''
          log.entityName = params.entityName ?? ''
          log.details = details
          ;(log._raw as Record<string, unknown>).created_at = now
        })
      })
    }

    if (activeRole !== 'owner') return

    supabase
      .from('activity_logs')
      .insert({
        id: logId,
        business_id: business.id,
        actor_id: actorId,
        actor_name: actorName,
        actor_role: activeRole,
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId,
        entity_name: params.entityName,
        details: params.details,
        created_at: new Date(now).toISOString(),
      })
      .then(({ error }) => {
        if (error) console.warn('Log sync:', error.message)
      })
  } catch (err) {
    console.warn('Activity log error:', err)
  }
}
