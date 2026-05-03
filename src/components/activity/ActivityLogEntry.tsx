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

export function activityLogTitle(log: ActivityLog): string {
  const label = ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')
  return log.entityName ? `${label}: ${log.entityName}` : label
}

function timeLabel(ms: number) {
  const date = new Date(ms)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function ActivityLogEntry({ log }: { log: ActivityLog }) {
  const isStaff = log.actorRole === 'shopkeeper'

  return (
    <Card padding="md" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, isStaff ? styles.staffIcon : styles.ownerIcon]}>
          <Ionicons name={isStaff ? 'person-outline' : 'shield-checkmark-outline'} size={18} color={isStaff ? '#B45309' : '#0047AB'} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{activityLogTitle(log)}</Text>
            <Badge label={isStaff ? `Staff · ${log.actorName}` : 'Owner'} variant={isStaff ? 'warning' : 'info'} size="sm" />
          </View>
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
  meta: { fontSize: 12, color: '#5A6A8A', marginTop: 4 },
})
