import { useEffect, useState } from 'react'
import { InteractionManager } from 'react-native'
import { Q } from '@nozbe/watermelondb'

import { database } from '../database'
import Business from '../database/models/Business'
import { formatMonthYear } from '../lib/formatters'

export interface SettingsStats {
  totalSales: number
  productCount: number
  customerCount: number
  memberSince: string
}

const EMPTY_STATS: SettingsStats = {
  totalSales: 0,
  productCount: 0,
  customerCount: 0,
  memberSince: '',
}

export function useDeferredSettingsStats(
  businessId: string | undefined,
  userId: string | undefined,
): SettingsStats {
  const [stats, setStats] = useState<SettingsStats>(EMPTY_STATS)

  useEffect(() => {
    if (!businessId || !database) return

    let cancelled = false
    const task = InteractionManager.runAfterInteractions(() => {
      const db = database
      if (!db) return

      void Promise.all([
        db.get('sales').query(Q.where('business_id', businessId)).fetchCount(),
        db
          .get('products')
          .query(Q.where('business_id', businessId), Q.where('is_active', true))
          .fetchCount(),
        db.get('customers').query(Q.where('business_id', businessId)).fetchCount(),
        db.get<Business>('businesses').query().fetch(),
      ]).then(([salesCount, productCount, customerCount, bizRecords]) => {
        if (cancelled) return

        let memberSince = ''
        const bizRecord = bizRecords.find((r) => r.supabaseId === userId) ?? bizRecords[0]
        if (bizRecord?.createdAt) {
          const ts =
            bizRecord.createdAt instanceof Date
              ? bizRecord.createdAt.getTime()
              : (bizRecord.createdAt as unknown as number)
          if (ts > 0) memberSince = formatMonthYear(ts)
        }

        setStats({
          totalSales: salesCount,
          productCount,
          customerCount,
          memberSince,
        })
      })
    })

    return () => {
      cancelled = true
      task.cancel()
    }
  }, [businessId, userId])

  return stats
}
