import React, { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { DeviceApprovalRequest } from '../../types'
import { Card } from '../ui'

interface DeviceApprovalModalProps {
  requests: DeviceApprovalRequest[]
  onApprove: (id: string) => Promise<void>
  onDeny: (id: string) => Promise<void>
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?'
}

function timeLabel(value: string): string {
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return 'Just now'
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function DeviceApprovalModal({
  requests,
  onApprove,
  onDeny,
}: DeviceApprovalModalProps) {
  const [processingId, setProcessingId] = useState<string | null>(null)

  const run = async (id: string, fn: (id: string) => Promise<void>) => {
    setProcessingId(id)
    try {
      await fn(id)
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <Modal
      visible={requests.length > 0}
      transparent
      animationType="slide"
      onRequestClose={() => {}}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <View style={styles.overlay} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Ionicons name="shield-outline" size={24} color="#FFFFFF" />
              <View style={styles.headerText}>
                <Text style={styles.title}>Staff Login Request</Text>
                <Text style={styles.subtitle}>
                  {requests.length} request{requests.length === 1 ? '' : 's'} waiting
                </Text>
              </View>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {requests.map((request) => {
              const isProcessing = processingId === request.id
              return (
                <Card key={request.id} padding="md" style={styles.requestCard}>
                  <View style={styles.personRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(request.shopkeeperName)}</Text>
                    </View>
                    <View style={styles.personText}>
                      <Text style={styles.name}>{request.shopkeeperName}</Text>
                      <Text style={styles.body}>Wants to log in on a new device</Text>
                    </View>
                  </View>

                  <View style={styles.deviceBox}>
                    <Ionicons name="phone-portrait-outline" size={16} color="#5A6A8A" />
                    <Text style={styles.deviceName}>{request.deviceName || 'Unknown device'}</Text>
                    <Text style={styles.time}>{timeLabel(request.requestedAt)}</Text>
                  </View>

                  <View style={styles.warningRow}>
                    <Ionicons name="warning-outline" size={14} color="#B45309" />
                    <Text style={styles.warningText}>
                      Only approve if you recognise this person and device.
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.denyButton]}
                      disabled={isProcessing}
                      onPress={() => void run(request.id, onDeny)}
                    >
                      {isProcessing ? (
                        <ActivityIndicator size="small" color="#C0152A" />
                      ) : (
                        <Text style={styles.denyText}>Deny Access</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.allowButton]}
                      disabled={isProcessing}
                      onPress={() => void run(request.id, onApprove)}
                    >
                      {isProcessing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.allowText}>Allow Access</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </Card>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '82%',
    overflow: 'hidden',
  },
  header: { backgroundColor: '#0047AB', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerText: { marginLeft: 12 },
  title: { fontSize: 18, fontWeight: '500', color: '#FFFFFF' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  content: { padding: 16, paddingBottom: 28 },
  requestCard: { marginBottom: 10 },
  personRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0047AB', fontWeight: '700' },
  personText: { marginLeft: 12, flex: 1 },
  name: { fontSize: 16, fontWeight: '500', color: '#0D1B3E' },
  body: { fontSize: 13, color: '#5A6A8A', marginTop: 2 },
  deviceBox: {
    backgroundColor: '#F4F6FB',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceName: { flex: 1, marginLeft: 8, fontSize: 13, color: '#0D1B3E' },
  time: { fontSize: 12, color: '#5A6A8A' },
  warningRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  warningText: { marginLeft: 6, fontSize: 12, color: '#B45309', flex: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionButton: {
    height: 44,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  denyButton: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#C0152A' },
  allowButton: { backgroundColor: '#0047AB' },
  denyText: { color: '#C0152A', fontSize: 14, fontWeight: '500' },
  allowText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
})
