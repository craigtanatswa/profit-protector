import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { ActivityLog } from '../../types'
import { Badge, Card } from '../ui'

const ACTION_LABELS: Record<string, string> = {
  sale_completed: 'Completed sale',
  sale_voided: 'Voided sale',
  product_added: 'Added product',
  product_edited: 'Edited product',
  product_deactivated: 'Deactivated product',
  stock_received: 'Received stock',
  stock_adjusted: 'Adjusted stock',
  customer_added: 'Added customer',
  customer_edited: 'Edited customer',
  payment_recorded: 'Recorded payment',
  shopkeeper_added: 'Added staff member',
  shopkeeper_deactivated: 'Deactivated staff member',
  shopkeeper_deleted: 'Deleted staff account',
  shopkeeper_password_changed: 'Changed staff password',
  device_approved: 'Approved device',
  device_denied: 'Denied device',
  business_profile_updated: 'Updated business profile',
  password_changed: 'Changed password',
  data_exported: 'Exported data',
  data_synced: 'Synced data',
  account_login_owner: 'Owner signed in',
  account_login_shopkeeper: 'Staff signed in',
  account_logout: 'Signed out',
}

const STOCK_SUCCESS = '#0A7A4B'
const STOCK_SUCCESS_BG = '#EAF3DE'
const STOCK_DANGER = '#C0152A'
const STOCK_DANGER_BG = '#FCEBEB'

export function activityLogTitle(log: ActivityLog): string {
  const label = ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')
  return log.entityName ? `${label}: ${log.entityName}` : label
}

function timeLabel(ms: number) {
  const date = new Date(ms)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function stockQtyMeta(log: ActivityLog): { text: string; color: string; bgColor: string } | null {
  if (log.action === 'stock_adjusted') {
    const qtyChange = Number(log.details?.qtyChange)
    if (!Number.isFinite(qtyChange)) return null
    const unit = String(log.details?.unit ?? 'units')
    if (qtyChange > 0) {
      return {
        text: `+${qtyChange} ${unit}`,
        color: STOCK_SUCCESS,
        bgColor: STOCK_SUCCESS_BG,
      }
    }
    if (qtyChange < 0) {
      return {
        text: `\u2212${Math.abs(qtyChange)} ${unit}`,
        color: STOCK_DANGER,
        bgColor: STOCK_DANGER_BG,
      }
    }
    return { text: `0 ${unit}`, color: '#5A6A8A', bgColor: '#F4F6FB' }
  }

  if (log.action === 'stock_received') {
    const qty = Number(log.details?.qty)
    if (!Number.isFinite(qty) || qty <= 0) return null
    const unit = String(log.details?.unit ?? 'units')
    return {
      text: `+${qty} ${unit}`,
      color: STOCK_SUCCESS,
      bgColor: STOCK_SUCCESS_BG,
    }
  }

  return null
}

function stockReasonLabel(log: ActivityLog): string | null {
  if (log.action === 'stock_adjusted') {
    const reason = log.details?.reason
    if (reason == null || String(reason).trim().length === 0) return null
    return String(reason)
  }
  if (log.action === 'stock_received') {
    const supplier = log.details?.supplier
    if (supplier == null || String(supplier).trim().length === 0) return null
    return String(supplier)
  }
  return null
}

function stockIconInfo(log: ActivityLog): {
  icon: keyof typeof Ionicons.glyphMap
  bgColor: string
  iconColor: string
} | null {
  const qtyMeta = stockQtyMeta(log)
  if (!qtyMeta) return null

  if (log.action === 'stock_received') {
    return { icon: 'arrow-down-circle-outline', bgColor: qtyMeta.bgColor, iconColor: qtyMeta.color }
  }

  const qtyChange = Number(log.details?.qtyChange)
  if (qtyChange < 0) {
    return { icon: 'remove-circle-outline', bgColor: qtyMeta.bgColor, iconColor: qtyMeta.color }
  }
  return { icon: 'add-circle-outline', bgColor: qtyMeta.bgColor, iconColor: qtyMeta.color }
}

export function ActivityLogEntry({ log }: { log: ActivityLog }) {
  const isStaff = log.actorRole === 'shopkeeper'
  const qtyMeta = stockQtyMeta(log)
  const reasonLabel = stockReasonLabel(log)
  const stockIcon = stockIconInfo(log)

  return (
    <Card padding="md" style={styles.card}>
      <View style={styles.row}>
        <View
          style={[
            styles.iconWrap,
            stockIcon
              ? { backgroundColor: stockIcon.bgColor }
              : isStaff
                ? styles.staffIcon
                : styles.ownerIcon,
          ]}
        >
          <Ionicons
            name={
              stockIcon?.icon ??
              (isStaff ? 'person-outline' : 'shield-checkmark-outline')
            }
            size={18}
            color={stockIcon?.iconColor ?? (isStaff ? '#B45309' : '#0047AB')}
          />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{activityLogTitle(log)}</Text>
            <Badge label={isStaff ? `Staff · ${log.actorName}` : 'Owner'} variant={isStaff ? 'warning' : 'info'} size="sm" />
          </View>
          {qtyMeta ? (
            <View style={styles.qtyRow}>
              <Text style={[styles.qtyChange, { color: qtyMeta.color }]}>{qtyMeta.text}</Text>
              {reasonLabel ? <Text style={styles.reason}>{reasonLabel}</Text> : null}
            </View>
          ) : null}
          <Text style={styles.meta}>{timeLabel(log.createdAt)}</Text>
        </View>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  ownerIcon: { backgroundColor: '#E6EEFF' },
  staffIcon: { backgroundColor: '#FAEEDA' },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0D1B3E' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  qtyChange: { fontSize: 14, fontWeight: '700' },
  reason: { fontSize: 12, color: '#5A6A8A', flexShrink: 1 },
  meta: { fontSize: 12, color: '#5A6A8A', marginTop: 4 },
})
