import { Ionicons } from '@expo/vector-icons'
import { Q } from '@nozbe/watermelondb'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { z } from 'zod'

import { Badge, Button, Card, EmptyState, Input } from '../../../src/components/ui'
import { ScreenHeader } from '../../../src/components/layout'
import { SettingsRow } from '../../../src/components/settings/SettingsRow'
import { database } from '../../../src/database'
import ShopkeeperModel from '../../../src/database/models/Shopkeeper'
import { hashPasswordClient } from '../../../src/lib/hashPassword'
import { logActivity } from '../../../src/lib/activityLogger'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/stores/authStore'
import type { Shopkeeper } from '../../../src/types'

const addShopkeeperSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30)
    .regex(/^[a-z0-9._]+$/, 'Only lowercase letters, numbers, dots, and underscores'),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type StaffDevice = { id: string; deviceName: string; approvedAt: string }

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
}

function formatDate(ms: number | string) {
  const date = typeof ms === 'number' ? new Date(ms) : new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function mapLocal(record: ShopkeeperModel): Shopkeeper {
  return {
    id: record.id,
    businessId: record.businessId,
    supabaseId: record.supabaseId,
    username: record.username,
    fullName: record.fullName,
    phone: record.phone ?? undefined,
    isActive: record.isActive,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  }
}

function StaffCard({
  staff,
  deviceCount,
  onPress,
}: {
  staff: Shopkeeper
  deviceCount: number
  onPress: () => void
}) {
  return (
    <Card padding="md" style={styles.staffCard} onPress={onPress}>
      <View style={styles.staffTop}>
        <View style={styles.staffLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(staff.fullName)}</Text>
          </View>
          <View>
            <Text style={styles.staffName}>{staff.fullName}</Text>
            <Text style={styles.username}>@{staff.username}</Text>
          </View>
        </View>
        <Badge label={staff.isActive ? 'Active' : 'Inactive'} variant={staff.isActive ? 'success' : 'neutral'} size="sm" />
      </View>
      <View style={styles.devicesRow}>
        <Ionicons name="phone-portrait-outline" size={13} color="#5A6A8A" />
        <Text style={styles.devicesText}>{deviceCount} approved device{deviceCount === 1 ? '' : 's'}</Text>
      </View>
    </Card>
  )
}

function AddShopkeeperModal({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!visible || !business?.id || username.trim().length < 3) {
      setAvailable(null)
      return undefined
    }

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('shopkeepers')
        .select('id')
        .eq('business_id', business.id)
        .eq('username', username.toLowerCase().trim())
        .maybeSingle()
      setAvailable(!data)
    }, 800)

    return () => clearTimeout(timer)
  }, [business?.id, username, visible])

  const reset = () => {
    setFullName('')
    setUsername('')
    setPhone('')
    setPassword('')
    setConfirmPassword('')
    setErrors({})
    setAvailable(null)
  }

  const save = async () => {
    if (!business || !database) return
    const db = database
    const parsed = addShopkeeperSchema.safeParse({
      fullName,
      username,
      phone,
      password,
      confirmPassword,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      parsed.error.issues.forEach((issue) => {
        const key = String(issue.path[0] ?? 'form')
        next[key] = issue.message
      })
      setErrors(next)
      return
    }
    if (available === false) {
      setErrors({ username: 'This username is already taken' })
      return
    }

    setSaving(true)
    try {
      const cleanUsername = username.toLowerCase().trim()
      const cleanName = fullName.trim()
      const passwordHash = await hashPasswordClient(password)
      const { data, error } = await supabase
        .from('shopkeepers')
        .insert({
          business_id: business.id,
          username: cleanUsername,
          password_hash: passwordHash,
          full_name: cleanName,
          phone: phone.trim() || null,
          is_active: true,
          created_by: user?.id ?? null,
        })
        .select('*')
        .single()

      if (error || !data) {
        Alert.alert('Could not add staff member', error?.message ?? 'Please try again.')
        return
      }

      const now = Date.now()
      await db.write(async () => {
        await db.get<ShopkeeperModel>('shopkeepers').create((record) => {
          record._raw.id = data.id
          record.businessId = business.id
          record.supabaseId = data.id
          record.username = cleanUsername
          record.fullName = cleanName
          record.phone = phone.trim() || null
          record.isActive = true
          ;(record._raw as Record<string, unknown>).created_at = now
          ;(record._raw as Record<string, unknown>).updated_at = now
        })
      })

      await logActivity({
        action: 'shopkeeper_added',
        entityType: 'shopkeeper',
        entityId: data.id,
        entityName: cleanName,
      })

      const publicId = business.publicId ?? `pp-${business.id.slice(0, 8).toLowerCase()}`
      reset()
      onClose()
      onAdded()
      Alert.alert(
        'Staff member added!',
        `${cleanName} can now log in with:\n\nBusiness ID: ${publicId}\nUsername: ${cleanUsername}`,
        [
          { text: 'OK' },
          {
            text: 'Share login details',
            onPress: () => {
              void Share.share({
                message:
                  `Profit Protector Login Details\nBusiness ID: ${publicId}\nUsername: ${cleanUsername}\nDownload Profit Protector: [app link]`,
              })
            },
          },
        ],
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.modalTitle}>Add Staff Member</Text>
          <Text style={styles.modalSubtitle}>Create login credentials for your staff</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.fields}>
              <Input label="Full Name" placeholder="e.g. Farai Moyo" value={fullName} onChangeText={setFullName} autoCapitalize="words" error={errors.fullName} leftIcon={<Ionicons name="person-outline" size={18} color="#5A6A8A" />} />
              <Input label="Username" hint="Lowercase, no spaces." placeholder="e.g. farai.moyo" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} error={errors.username} leftIcon={<Ionicons name="at-outline" size={18} color="#5A6A8A" />} />
              {username ? (
                <Text style={[styles.preview, available === false && styles.previewBad]}>
                  @{username.toLowerCase().trim()} {available === true ? '✓ available' : available === false ? '✕ taken' : ''}
                </Text>
              ) : null}
              <Input label="Phone Number (optional)" hint="For your records only" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <Input label="Password" hint="Minimum 8 characters" value={password} onChangeText={setPassword} secureTextEntry error={errors.password} leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#5A6A8A" />} />
              <Input label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry error={errors.confirmPassword} />
            </View>
            <View style={styles.modalActions}>
              <Button label="Add Staff Member" onPress={save} loading={saving} disabled={saving} />
              <Button label="Cancel" onPress={onClose} variant="secondary" disabled={saving} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function DetailModal({
  staff,
  visible,
  onClose,
  onChanged,
}: {
  staff: Shopkeeper | null
  visible: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [devices, setDevices] = useState<StaffDevice[]>([])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetVisible, setResetVisible] = useState(false)

  const loadDevices = useCallback(async () => {
    if (!staff) return
    const { data } = await supabase
      .from('shopkeeper_devices')
      .select('id, device_name, approved_at')
      .eq('shopkeeper_id', staff.supabaseId)
      .eq('is_approved', true)
      .order('approved_at', { ascending: false })
    setDevices((data ?? []).map((d) => ({
      id: d.id,
      deviceName: d.device_name ?? 'Unknown device',
      approvedAt: d.approved_at ?? '',
    })))
  }, [staff])

  useEffect(() => {
    if (visible) void loadDevices()
  }, [loadDevices, visible])

  const deactivate = () => {
    if (!staff) return
    Alert.alert('Deactivate Staff Member?', 'They will not be able to log in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('shopkeepers').update({ is_active: false }).eq('id', staff.supabaseId)
          if (database) {
            const db = database
            const record = await db.get<ShopkeeperModel>('shopkeepers').find(staff.id)
            await db.write(async () => {
              await record.update((r) => {
                r.isActive = false
                ;(r._raw as Record<string, unknown>).updated_at = Date.now()
              })
            })
          }
          await logActivity({ action: 'shopkeeper_deactivated', entityType: 'shopkeeper', entityId: staff.supabaseId, entityName: staff.fullName })
          onChanged()
          onClose()
        },
      },
    ])
  }

  const resetPassword = async () => {
    if (!staff) return
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      Alert.alert('Invalid password', 'Password must be at least 8 characters and match confirmation.')
      return
    }
    const passwordHash = await hashPasswordClient(newPassword)
    await supabase.from('shopkeepers').update({ password_hash: passwordHash }).eq('id', staff.supabaseId)
    await logActivity({ action: 'shopkeeper_password_changed', entityType: 'shopkeeper', entityId: staff.supabaseId, entityName: staff.fullName })
    setNewPassword('')
    setConfirmPassword('')
    setResetVisible(false)
    Alert.alert('Password updated', `Share the new password with ${staff.fullName}.`)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.modalTitle}>{staff?.fullName}</Text>
          <Text style={styles.modalSubtitle}>@{staff?.username}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <SettingsRow icon="at-outline" label="Username" value={`@${staff?.username ?? ''}`} showChevron={false} />
            <SettingsRow icon="call-outline" label="Phone" value={staff?.phone || '—'} showChevron={false} />
            <SettingsRow icon="calendar-outline" label="Added" value={staff ? formatDate(staff.createdAt) : '—'} showChevron={false} />
            <SettingsRow icon="shield-checkmark-outline" label="Status" value={staff?.isActive ? 'Active' : 'Inactive'} showChevron={false} />

            <Text style={styles.sectionMiniTitle}>Approved Devices</Text>
            {devices.length === 0 ? <Text style={styles.muted}>No approved devices yet.</Text> : devices.map((device) => (
              <View key={device.id} style={styles.deviceRow}>
                <View style={styles.flex}>
                  <Text style={styles.deviceName}>{device.deviceName}</Text>
                  <Text style={styles.muted}>Approved {formatDate(device.approvedAt)}</Text>
                </View>
                <TouchableOpacity
                  onPress={async () => {
                    await supabase.from('shopkeeper_devices').delete().eq('id', device.id)
                    await loadDevices()
                  }}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}

            <SettingsRow icon="key-outline" label="Reset Password" onPress={() => setResetVisible(true)} />
            {staff?.isActive ? (
              <SettingsRow destructive icon="person-remove-outline" label="Deactivate Staff Member" description="They will not be able to log in" onPress={deactivate} />
            ) : null}

            {resetVisible ? (
              <Card padding="md" style={styles.resetCard}>
                <Input label="New Password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
                <Input label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
                <Button label="Save New Password" onPress={resetPassword} />
              </Card>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function ManageStaffScreen() {
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const [staff, setStaff] = useState<Shopkeeper[]>([])
  const [deviceCounts, setDeviceCounts] = useState<Record<string, number>>({})
  const [addVisible, setAddVisible] = useState(false)
  const [selected, setSelected] = useState<Shopkeeper | null>(null)
  const publicId = business?.publicId ?? (business?.id ? `pp-${business.id.slice(0, 8).toLowerCase()}` : '')

  const loadStaff = useCallback(async () => {
    if (!business?.id || !database || activeRole !== 'owner') return
    const records = await database
      .get<ShopkeeperModel>('shopkeepers')
      .query(Q.where('business_id', business.id))
      .fetch()
    const localStaff = records.map(mapLocal)
    setStaff(localStaff)

    const { data } = await supabase
      .from('shopkeepers')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })

    if (data) {
      const remoteStaff = data.map((row) => ({
        id: row.id,
        businessId: row.business_id,
        supabaseId: row.id,
        username: row.username,
        fullName: row.full_name,
        phone: row.phone ?? undefined,
        isActive: row.is_active === true,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at ?? row.created_at).getTime(),
      }))
      setStaff(remoteStaff)
    }

    const counts: Record<string, number> = {}
    await Promise.all((data ?? []).map(async (row) => {
      const { count } = await supabase
        .from('shopkeeper_devices')
        .select('*', { count: 'exact', head: true })
        .eq('shopkeeper_id', row.id)
        .eq('is_approved', true)
      counts[row.id] = count ?? 0
    }))
    setDeviceCounts(counts)
  }, [activeRole, business?.id])

  useFocusEffect(useCallback(() => {
    void loadStaff()
  }, [loadStaff]))

  if (activeRole !== 'owner') {
    return null
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title="Manage Staff"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'person-add-outline', onPress: () => setAddVisible(true) }}
        showBorder
      />
      <FlatList
        data={staff}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Card padding="md" style={styles.businessIdCard}>
            <View style={styles.businessIdHintRow}>
              <Ionicons name="information-circle" size={18} color="#0047AB" />
              <Text style={styles.businessIdHint}>Share this ID with staff so they can log in</Text>
            </View>
            <Text style={styles.businessId}>{publicId}</Text>
            <Button label="Copy Business ID" variant="secondary" size="sm" onPress={() => void Clipboard.setStringAsync(publicId)} />
          </Card>
        }
        renderItem={({ item }) => (
          <StaffCard
            staff={item}
            deviceCount={deviceCounts[item.supabaseId] ?? 0}
            onPress={() => setSelected(item)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No staff added yet"
            subtitle="Add a staff member so they can log in and record sales using their own account"
            actionLabel="Add Staff Member"
            onAction={() => setAddVisible(true)}
          />
        }
      />
      <AddShopkeeperModal visible={addVisible} onClose={() => setAddVisible(false)} onAdded={loadStaff} />
      <DetailModal
        staff={selected}
        visible={selected != null}
        onClose={() => setSelected(null)}
        onChanged={loadStaff}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  listContent: { padding: 16, paddingBottom: 32 },
  businessIdCard: { backgroundColor: '#E6EEFF', borderColor: '#0047AB', marginBottom: 16 },
  businessIdHintRow: { flexDirection: 'row', alignItems: 'center' },
  businessIdHint: { marginLeft: 6, fontSize: 13, color: '#0047AB', flex: 1 },
  businessId: { fontSize: 20, fontWeight: '500', color: '#0047AB', fontFamily: 'monospace', textAlign: 'center', marginVertical: 12 },
  staffCard: { marginBottom: 8 },
  staffTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  staffLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E6EEFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#0047AB', fontWeight: '700' },
  staffName: { fontSize: 15, fontWeight: '500', color: '#0D1B3E' },
  username: { fontSize: 13, color: '#5A6A8A', marginTop: 2 },
  devicesRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  devicesText: { marginLeft: 4, fontSize: 12, color: '#5A6A8A' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 32, maxHeight: '90%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDE3F0', alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#0D1B3E' },
  modalSubtitle: { fontSize: 13, color: '#5A6A8A', marginTop: 4, marginBottom: 16 },
  fields: { gap: 14 },
  preview: { color: '#0047AB', fontSize: 12, marginTop: -8 },
  previewBad: { color: '#C0152A' },
  modalActions: { gap: 10, marginTop: 20, marginBottom: 8 },
  sectionMiniTitle: { fontSize: 12, fontWeight: '700', color: '#5A6A8A', marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  muted: { fontSize: 12, color: '#5A6A8A' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#F4F6FB' },
  flex: { flex: 1 },
  deviceName: { fontSize: 14, fontWeight: '500', color: '#0D1B3E' },
  removeText: { fontSize: 13, color: '#C0152A', fontWeight: '600' },
  resetCard: { marginTop: 12, gap: 12 },
})

export default ManageStaffScreen
