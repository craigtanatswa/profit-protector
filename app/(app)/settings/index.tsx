/*
 * Run this SQL in Supabase SQL Editor:
 *
 * create table if not exists deletion_requests (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users(id),
 *   requested_at timestamptz default now(),
 *   processed boolean default false
 * );
 *
 * alter table deletion_requests enable row level security;
 *
 * create policy "Users can insert own deletion request"
 * on deletion_requests for insert
 * with check (auth.uid() = user_id);
 *
 * -- ZiG per $1 USD (display conversion; ledger stays USD cents)
 * alter table businesses add column if not exists zig_rate_per_usd numeric default 1;
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { Q } from '@nozbe/watermelondb'

import { Button, Input, LoadingScreen } from '../../../src/components/ui'
import { ScreenHeader } from '../../../src/components/layout'
import { SettingsRow } from '../../../src/components/settings/SettingsRow'
import { SettingsSection } from '../../../src/components/settings/SettingsSection'
import { useAuthStore } from '../../../src/stores/authStore'
import { database } from '../../../src/database'
import { supabase } from '../../../src/lib/supabase'
import { exportReportCSV } from '../../../src/lib/reportCSV'
import { syncAll } from '../../../src/lib/sync'
import { formatDateTime, formatMonthYear } from '../../../src/lib/formatters'
import { buildSupabaseEmailFromPhone, buildLegacySupabaseEmailFromPhone } from '../../../src/lib/authIdentity'
import Business from '../../../src/database/models/Business'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReceiptSettings {
  businessName: string
  footer: string
  prefix: string
}

interface Stats {
  totalSales: number
  productCount: number
  customerCount: number
  memberSince: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getSyncIconColor(status: string): string {
  if (status === 'syncing') return '#0047AB'
  if (status === 'error') return '#C0152A'
  return '#0A7A4B'
}

function getSyncIconBg(status: string): string {
  if (status === 'syncing') return '#E6EEFF'
  if (status === 'error') return '#FCEBEB'
  return '#EAF3DE'
}

function getSyncValueText(status: string, lastSyncedAt: number | null): string {
  if (status === 'syncing') return 'Syncing...'
  if (status === 'error') return 'Sync failed'
  if (status === 'success' && lastSyncedAt) return `Synced ${timeAgo(lastSyncedAt)}`
  return 'Up to date'
}

// ---------------------------------------------------------------------------
// ModalSheet — reusable bottom-sheet wrapper
// ---------------------------------------------------------------------------

function ModalSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={ms.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={ms.root}>
          <TouchableOpacity style={ms.overlay} activeOpacity={1} onPress={onClose} />
          <View style={ms.sheet}>
            <View style={ms.handle} />
            <Text style={ms.title}>{title}</Text>
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const ms = StyleSheet.create({
  kav: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3F0',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    marginBottom: 20,
  },
})

// ---------------------------------------------------------------------------
// EditBusinessModal
// ---------------------------------------------------------------------------

const BUSINESS_TYPES = [
  'Retail Shop',
  'Hardware',
  'Salon/Barber',
  'Restaurant/Takeaway',
  'Pharmacy',
  'Other',
]

function EditBusinessModal({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const setBusiness = useAuthStore((s) => s.setBusiness)

  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; ownerName?: string; businessType?: string }>({})

  useEffect(() => {
    if (visible && business) {
      setName(business.name)
      setOwnerName(business.ownerName)
      setBusinessType(business.businessType)
      setErrors({})
    }
  }, [visible, business])

  const validate = (): boolean => {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = 'Business name is required'
    if (!ownerName.trim()) errs.ownerName = 'Owner name is required'
    if (!businessType) errs.businessType = 'Please select a business type'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate() || !business || !database) return
    setSaving(true)
    try {
      // Update WatermelonDB
      const records = await database.get<Business>('businesses').query().fetch()
      const localRecord = records.find((r) => r.supabaseId === user?.id) ?? records[0]
      if (localRecord) {
        await database.write(async () => {
          await localRecord.update((b) => {
            b.name = name.trim()
            b.ownerName = ownerName.trim()
            b.businessType = businessType
          })
        })
      }

      // Update Supabase
      await supabase
        .from('businesses')
        .update({
          name: name.trim(),
          owner_name: ownerName.trim(),
          business_type: businessType,
        })
        .eq('id', business.id)

      // Update store
      setBusiness({ ...business, name: name.trim(), ownerName: ownerName.trim(), businessType })
      onClose()
    } catch (err) {
      Alert.alert('Error', 'Could not save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Edit Business Profile">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={eb.fields}>
          <Input
            label="Business Name"
            placeholder="e.g. Tino's General Store"
            value={name}
            onChangeText={setName}
            error={errors.name}
            editable={!saving}
            autoCapitalize="words"
          />
          <Input
            label="Owner Name"
            placeholder="e.g. Tinashe Moyo"
            value={ownerName}
            onChangeText={setOwnerName}
            error={errors.ownerName}
            editable={!saving}
            autoCapitalize="words"
          />

          <View>
            <Text style={eb.typeLabel}>Business Type</Text>
            <View style={eb.pillWrap}>
              {BUSINESS_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[eb.pill, businessType === type && eb.pillActive]}
                  onPress={() => setBusinessType(type)}
                  disabled={saving}
                >
                  <Text style={[eb.pillText, businessType === type && eb.pillTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {errors.businessType ? (
              <Text style={eb.typeError}>{errors.businessType}</Text>
            ) : null}
          </View>

          <Input
            label="Phone Number"
            value={business?.phone ?? ''}
            editable={false}
            hint="Contact support to change your phone number"
            onChangeText={() => {}}
          />
        </View>

        <View style={eb.actions}>
          <Button
            label={saving ? 'Saving...' : 'Save Changes'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={saving}
          />
          <Button
            label="Cancel"
            onPress={onClose}
            variant="secondary"
            size="lg"
            fullWidth
            disabled={saving}
          />
        </View>
      </ScrollView>
    </ModalSheet>
  )
}

const eb = StyleSheet.create({
  fields: { gap: 16 },
  typeLabel: { fontSize: 14, fontWeight: '500', color: '#0D1B3E', marginBottom: 8 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#F4F6FB',
  },
  pillActive: { borderColor: '#0047AB', backgroundColor: '#E6EEFF' },
  pillText: { fontSize: 13, color: '#5A6A8A' },
  pillTextActive: { color: '#0047AB', fontWeight: '600' },
  typeError: { fontSize: 12, color: '#C0152A', marginTop: 4 },
  actions: { gap: 10, marginTop: 24, marginBottom: 8 },
})

// ---------------------------------------------------------------------------
// CurrencyModal
// ---------------------------------------------------------------------------

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)', description: 'All prices shown in US Dollars' },
  { value: 'ZiG', label: 'ZiG', description: 'All prices shown in Zimbabwe Gold' },
  { value: 'Both', label: 'Both', description: 'Show prices in both USD and ZiG' },
]

function CurrencyModal({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const setBusiness = useAuthStore((s) => s.setBusiness)

  const [selected, setSelected] = useState(business?.currency ?? 'USD')
  const [zigRateInput, setZigRateInput] = useState('1')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible && business) {
      setSelected(business.currency)
      setZigRateInput(String(business.zigRatePerUsd ?? 1))
    }
  }, [visible, business])

  const handleSave = async () => {
    if (!business || !database) return

    let newZigRate = business.zigRatePerUsd ?? 1
    if (selected === 'ZiG' || selected === 'Both') {
      const parsed = parseFloat(zigRateInput.replace(/,/g, '').trim())
      if (!Number.isFinite(parsed) || parsed <= 0) {
        Alert.alert('Invalid rate', 'Enter a positive number for ZiG per $1 USD (e.g. 30).')
        return
      }
      newZigRate = parsed
    }

    setSaving(true)
    try {
      const records = await database.get<Business>('businesses').query().fetch()
      const localRecord = records.find((r) => r.supabaseId === user?.id) ?? records[0]
      if (localRecord) {
        await database.write(async () => {
          await localRecord.update((b) => {
            b.currency = selected
            b.zigRatePerUsd = newZigRate
          })
        })
      }

      await supabase
        .from('businesses')
        .update({ currency: selected, zig_rate_per_usd: newZigRate })
        .eq('id', business.id)
      setBusiness({ ...business, currency: selected, zigRatePerUsd: newZigRate })
      onClose()
    } catch {
      Alert.alert('Error', 'Could not save currency. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const showRateField = selected === 'ZiG' || selected === 'Both'

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Currency Settings">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={cur.options}>
          {CURRENCY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[cur.card, selected === opt.value && cur.cardActive]}
              onPress={() => setSelected(opt.value)}
              disabled={saving}
            >
              <View style={cur.cardRow}>
                <Text style={[cur.cardLabel, selected === opt.value && cur.cardLabelActive]}>
                  {opt.label}
                </Text>
                {selected === opt.value ? (
                  <Ionicons name="checkmark-circle" size={20} color="#0047AB" />
                ) : (
                  <Ionicons name="ellipse-outline" size={20} color="#DDE3F0" />
                )}
              </View>
              <Text style={cur.cardDesc}>{opt.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {showRateField ? (
          <View style={cur.rateBlock}>
            <Input
              label="ZiG per $1 USD"
              placeholder="e.g. 30"
              value={zigRateInput}
              onChangeText={setZigRateInput}
              keyboardType="decimal-pad"
              hint="Stored amounts are still in USD; this rate converts them for display (e.g. $5 → ZiG 150 when rate is 30)."
              editable={!saving}
            />
          </View>
        ) : null}

        <View style={cur.actions}>
          <Button
            label={saving ? 'Saving...' : 'Save'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </ModalSheet>
  )
}

const cur = StyleSheet.create({
  options: { gap: 12 },
  rateBlock: { marginTop: 8 },
  card: {
    borderWidth: 1.5,
    borderColor: '#DDE3F0',
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#F4F6FB',
  },
  cardActive: { borderColor: '#0047AB', backgroundColor: '#E6EEFF' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardLabel: { fontSize: 16, fontWeight: '600', color: '#0D1B3E' },
  cardLabelActive: { color: '#0047AB' },
  cardDesc: { fontSize: 13, color: '#5A6A8A' },
  actions: { marginTop: 20 },
})

// ---------------------------------------------------------------------------
// ReceiptSettingsModal
// ---------------------------------------------------------------------------

function ReceiptSettingsModal({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const business = useAuthStore((s) => s.business)

  const [bizName, setBizName] = useState('')
  const [footer, setFooter] = useState('')
  const [prefix, setPrefix] = useState('RCP')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    SecureStore.getItemAsync('receipt_settings').then((val) => {
      if (val) {
        const parsed = JSON.parse(val) as ReceiptSettings
        setBizName(parsed.businessName)
        setFooter(parsed.footer)
        setPrefix(parsed.prefix || 'RCP')
      } else {
        setBizName(business?.name ?? '')
        setFooter('Thank you for your business!')
        setPrefix('RCP')
      }
    })
  }, [visible, business])

  const handleSave = async () => {
    setSaving(true)
    try {
      await SecureStore.setItemAsync(
        'receipt_settings',
        JSON.stringify({ businessName: bizName, footer, prefix }),
      )
      Alert.alert('Saved', 'Receipt settings have been updated.')
      onClose()
    } catch {
      Alert.alert('Error', 'Could not save receipt settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Receipt Settings">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={rs.fields}>
          <Input
            label="Business Name on Receipt"
            placeholder={business?.name ?? 'Your Business Name'}
            value={bizName}
            onChangeText={setBizName}
            hint="Shown at the top of every receipt"
            editable={!saving}
            autoCapitalize="words"
          />
          <Input
            label="Receipt Footer Message"
            placeholder="Thank you for your business!"
            value={footer}
            onChangeText={(t) => setFooter(t.slice(0, 100))}
            hint="Shown at the bottom of every receipt (max 100 chars)"
            editable={!saving}
            autoCapitalize="sentences"
          />
          <Input
            label="Receipt Number Prefix"
            placeholder="RCP"
            value={prefix}
            onChangeText={(t) => setPrefix(t.slice(0, 6).toUpperCase())}
            hint="e.g. RCP → RCP-0001, INV → INV-0001"
            editable={!saving}
            autoCapitalize="characters"
          />
        </View>

        <View style={rs.actions}>
          <Button
            label={saving ? 'Saving...' : 'Save Settings'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </ModalSheet>
  )
}

const rs = StyleSheet.create({
  fields: { gap: 16 },
  actions: { marginTop: 24, marginBottom: 8 },
})

// ---------------------------------------------------------------------------
// ChangePasswordModal
// ---------------------------------------------------------------------------

function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const business = useAuthStore((s) => s.business)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{
    currentPassword?: string
    newPassword?: string
    confirmPassword?: string
  }>({})

  useEffect(() => {
    if (!visible) return
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrors({})
    setShowCurrent(false)
    setShowNew(false)
    setShowConfirm(false)
  }, [visible])

  const validate = (): boolean => {
    const errs: typeof errors = {}
    if (!currentPassword) errs.currentPassword = 'Current password is required'
    if (!newPassword || newPassword.length < 6) errs.newPassword = 'New password must be at least 6 characters'
    if (newPassword !== confirmPassword) errs.confirmPassword = 'Passwords do not match'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate() || !business) return
    setSaving(true)
    try {
      // Re-authenticate with current password
      const primaryEmail = buildSupabaseEmailFromPhone(business.phone)
      const legacyEmail = buildLegacySupabaseEmailFromPhone(business.phone)

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: primaryEmail,
        password: currentPassword,
      })

      let reauthed = !authError
      if (!reauthed) {
        const { error: legacyError } = await supabase.auth.signInWithPassword({
          email: legacyEmail,
          password: currentPassword,
        })
        reauthed = !legacyError
      }

      if (!reauthed) {
        setErrors({ currentPassword: 'Current password is incorrect' })
        setSaving(false)
        return
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) {
        Alert.alert('Error', updateError.message)
        setSaving(false)
        return
      }

      Alert.alert('Success', 'Password updated successfully.')
      onClose()
    } catch {
      Alert.alert('Error', 'Could not update password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Change Password">
      <View style={cp.fields}>
        <Input
          label="Current Password"
          placeholder="Enter current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry={!showCurrent}
          error={errors.currentPassword}
          editable={!saving}
          rightIcon={
            <TouchableOpacity onPress={() => setShowCurrent((v) => !v)}>
              <Ionicons name={showCurrent ? 'eye-off-outline' : 'eye-outline'} size={18} color="#718096" />
            </TouchableOpacity>
          }
        />
        <Input
          label="New Password"
          placeholder="At least 6 characters"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry={!showNew}
          error={errors.newPassword}
          editable={!saving}
          rightIcon={
            <TouchableOpacity onPress={() => setShowNew((v) => !v)}>
              <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={18} color="#718096" />
            </TouchableOpacity>
          }
        />
        <Input
          label="Confirm New Password"
          placeholder="Repeat new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showConfirm}
          error={errors.confirmPassword}
          editable={!saving}
          rightIcon={
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#718096" />
            </TouchableOpacity>
          }
        />
      </View>

      <View style={cp.actions}>
        <Button
          label={saving ? 'Updating...' : 'Update Password'}
          onPress={handleSave}
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving}
        />
      </View>
    </ModalSheet>
  )
}

const cp = StyleSheet.create({
  fields: { gap: 16 },
  actions: { marginTop: 24 },
})

// ---------------------------------------------------------------------------
// DeleteConfirmModal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const router = useRouter()

  const [inputValue, setInputValue] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!visible) setInputValue('')
  }, [visible])

  const handleDelete = async () => {
    if (inputValue !== 'DELETE' || !user) return
    setDeleting(true)
    try {
      // Log deletion request
      await supabase.from('deletion_requests').insert({
        user_id: user.id,
        requested_at: new Date().toISOString(),
      })

      // Clear local WatermelonDB
      if (database) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (database as any).unsafeResetDatabase?.()
      }

      // Sign out
      await supabase.auth.signOut()
      logout()
      router.replace('/(auth)/login')
    } catch {
      Alert.alert('Error', 'Could not delete account. Please try again.')
      setDeleting(false)
    }
  }

  const canDelete = inputValue === 'DELETE'

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={ms.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.root}>
          <TouchableOpacity style={ms.overlay} activeOpacity={1} onPress={onClose} />
          <View style={dc.sheet}>
            <View style={ms.handle} />
            <View style={dc.iconWrap}>
              <Ionicons name="warning" size={32} color="#C0152A" />
            </View>
            <Text style={dc.title}>Delete Account</Text>
            <Text style={dc.body}>
              This will permanently delete your business, all products, sales history, and customer
              records. This action cannot be undone.
            </Text>
            <Text style={dc.label}>Type DELETE to confirm</Text>
            <TextInput
              style={[dc.input, canDelete && dc.inputReady]}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder="DELETE"
              placeholderTextColor="#AABBCC"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
            />
            <TouchableOpacity
              style={[dc.deleteBtn, !canDelete && dc.deleteBtnDisabled]}
              onPress={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={dc.deleteBtnText}>Delete My Account</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={dc.cancelBtn} onPress={onClose} disabled={deleting}>
              <Text style={dc.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const dc = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FCEBEB',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#C0152A', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 14, color: '#5A6A8A', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#0D1B3E', marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#DDE3F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#0D1B3E',
    marginBottom: 16,
    textAlign: 'center',
  },
  inputReady: { borderColor: '#C0152A' },
  deleteBtn: {
    backgroundColor: '#C0152A',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  deleteBtnDisabled: { backgroundColor: '#E0B0B5' },
  deleteBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelBtnText: { color: '#5A6A8A', fontSize: 15 },
})

// ---------------------------------------------------------------------------
// Main Settings Screen
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const syncStatus = useAuthStore((s) => s.syncStatus)
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt)
  const triggerSync = useAuthStore((s) => s.triggerSync)

  // Modal visibility
  const [editBizVisible, setEditBizVisible] = useState(false)
  const [currencyVisible, setCurrencyVisible] = useState(false)
  const [receiptVisible, setReceiptVisible] = useState(false)
  const [changePassVisible, setChangePassVisible] = useState(false)
  const [deleteVisible, setDeleteVisible] = useState(false)

  // Notification settings
  const [lowStockAlertsEnabled, setLowStockAlertsEnabled] = useState(true)
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(false)

  // Restore state
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('Restoring your data...')

  // Stats
  const [stats, setStats] = useState<Stats>({
    totalSales: 0,
    productCount: 0,
    customerCount: 0,
    memberSince: '',
  })

  // Load persisted settings
  useEffect(() => {
    SecureStore.getItemAsync('setting_low_stock_alerts').then((v) => {
      setLowStockAlertsEnabled(v !== 'false')
    })
    SecureStore.getItemAsync('setting_daily_summary').then((v) => {
      setDailySummaryEnabled(v === 'true')
    })
  }, [])

  // Load stats
  useEffect(() => {
    if (!business?.id || !database) return

    Promise.all([
      database.get('sales').query(Q.where('business_id', business.id)).fetchCount(),
      database
        .get('products')
        .query(Q.where('business_id', business.id), Q.where('is_active', true))
        .fetchCount(),
      database.get('customers').query(Q.where('business_id', business.id)).fetchCount(),
      database.get<Business>('businesses').query().fetch(),
    ]).then(([salesCount, productCount, customerCount, bizRecords]) => {
      let memberSince = ''
      const bizRecord = bizRecords.find((r) => r.supabaseId === user?.id) ?? bizRecords[0]
      if (bizRecord?.createdAt) {
        const ts =
          bizRecord.createdAt instanceof Date
            ? bizRecord.createdAt.getTime()
            : (bizRecord.createdAt as unknown as number)
        if (ts > 0) memberSince = formatMonthYear(ts)
      }
      setStats({ totalSales: salesCount, productCount, customerCount, memberSince })
    })
  }, [business?.id, user?.id])

  const toggleLowStock = useCallback(async (val: boolean) => {
    setLowStockAlertsEnabled(val)
    await SecureStore.setItemAsync('setting_low_stock_alerts', String(val))
  }, [])

  const toggleDailySummary = useCallback(async (val: boolean) => {
    setDailySummaryEnabled(val)
    await SecureStore.setItemAsync('setting_daily_summary', String(val))
  }, [])

  const handleSyncNow = useCallback(() => {
    if (business?.id) triggerSync(business.id)
  }, [business?.id, triggerSync])

  const handleBackupNow = useCallback(async () => {
    if (!business?.id) return
    try {
      await triggerSync(business.id)
      Alert.alert('Backup Complete', 'All your data is safely stored in the cloud.')
    } catch {
      Alert.alert('Backup Failed', 'Could not back up data. Please try again.')
    }
  }, [business?.id, triggerSync])

  const handleRestoreFromCloud = useCallback(() => {
    Alert.alert(
      'Restore from Cloud?',
      'This will replace all local data with your cloud backup. Any unsynced local changes will be lost. Make sure you have synced first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            if (!business?.id) return
            setRestoreMessage('Restoring your data...')
            setIsRestoring(true)
            try {
              await syncAll(business.id)
              router.replace('/(app)')
            } catch {
              Alert.alert('Restore Failed', 'Could not restore data. Please try again.')
              setIsRestoring(false)
            }
          },
        },
      ],
    )
  }, [business?.id, router])

  const handleExportAll = useCallback(async () => {
    if (!business) return
    try {
      await exportReportCSV({
        business: {
          id: business.id,
          name: business.name,
          currency: business.currency,
          zigRatePerUsd: business.zigRatePerUsd,
        },
        period: 'All Time',
        startMs: 0,
        endMs: Date.now(),
        businessId: business.id,
      })
    } catch (err) {
      Alert.alert('Export Failed', (err as Error)?.message ?? 'Could not export data.')
    }
  }, [business])

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign Out?',
      'Your data is safely backed up. You can sign back in anytime on any device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut()
            logout()
            router.replace('/(auth)/login')
          },
        },
      ],
    )
  }, [logout, router])

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your business, all products, sales history, and customer records. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => setDeleteVisible(true),
        },
      ],
    )
  }, [])

  const businessInitial = business?.name?.charAt(0)?.toUpperCase() ?? '?'

  if (isRestoring) {
    return <LoadingScreen message={restoreMessage} />
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Settings" showBorder />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Business Profile Hero ── */}
        <View style={s.hero}>
          <View style={s.heroAvatar}>
            <Text style={s.heroAvatarText}>{businessInitial}</Text>
          </View>
          <Text style={s.heroName}>{business?.name ?? 'My Business'}</Text>
          <Text style={s.heroOwner}>{business?.ownerName ?? ''}</Text>
          {business?.phone ? (
            <Text style={s.heroPhone}>{business.phone}</Text>
          ) : null}
          <TouchableOpacity style={s.heroEditBtn} onPress={() => setEditBizVisible(true)}>
            <Text style={s.heroEditBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* ── Stats Row ── */}
        <View style={s.statsCard}>
          <View style={s.statCol}>
            <Text style={[s.statValue, { color: '#0047AB' }]}>{stats.totalSales}</Text>
            <Text style={s.statLabel}>Total Sales</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={s.statValue}>{stats.productCount}</Text>
            <Text style={s.statLabel}>Products</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statValue, { fontSize: 16 }]}>{stats.memberSince || '—'}</Text>
            <Text style={s.statLabel}>Since</Text>
          </View>
        </View>

        {/* ── Section 1: Business ── */}
        <SettingsSection title="Business">
          <SettingsRow
            icon="business-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Business Profile"
            description="Name, type, contact details"
            onPress={() => setEditBizVisible(true)}
          />
          <SettingsRow
            icon="cash-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Currency Settings"
            value={business?.currency ?? 'USD'}
            onPress={() => setCurrencyVisible(true)}
          />
          <SettingsRow
            icon="receipt-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Receipt Settings"
            description="Receipt number format, footer message"
            onPress={() => setReceiptVisible(true)}
          />
        </SettingsSection>

        {/* ── Section 2: Sync & Backup ── */}
        <SettingsSection title="Sync & Backup">
          <SettingsRow
            icon="sync-outline"
            iconColor={getSyncIconColor(syncStatus)}
            iconBackground={getSyncIconBg(syncStatus)}
            label="Sync Status"
            value={getSyncValueText(syncStatus, lastSyncedAt)}
            showChevron={false}
            rightElement={
              syncStatus === 'syncing' ? (
                <ActivityIndicator size="small" color="#0047AB" style={{ marginLeft: 8 }} />
              ) : undefined
            }
          />
          <SettingsRow
            icon="cloud-upload-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Sync Now"
            description="Upload all local changes to cloud"
            onPress={handleSyncNow}
            disabled={syncStatus === 'syncing'}
            rightElement={
              syncStatus === 'syncing' ? (
                <ActivityIndicator size="small" color="#0047AB" style={{ marginRight: 8 }} />
              ) : undefined
            }
          />
          <SettingsRow
            icon="time-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Last Synced"
            value={lastSyncedAt ? formatDateTime(lastSyncedAt) : 'Never'}
            showChevron={false}
          />
          <SettingsRow
            icon="cloud-done-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Backup Now"
            description="Save all data to cloud immediately"
            onPress={handleBackupNow}
          />
          <SettingsRow
            icon="cloud-download-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Restore from Cloud"
            description="Overwrite local data with cloud data"
            onPress={handleRestoreFromCloud}
          />
        </SettingsSection>

        {/* ── Section 3: Data Management ── */}
        <SettingsSection title="Data Management">
          <SettingsRow
            icon="download-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Export All Data"
            description="Download complete business data as CSV"
            onPress={handleExportAll}
          />
          <SettingsRow
            icon="cube-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Manage Products"
            value={`${stats.productCount} products`}
            onPress={() => router.push('/(app)/inventory')}
          />
          <SettingsRow
            icon="people-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Manage Customers"
            value={`${stats.customerCount} customers`}
            onPress={() => router.push('/(app)/customers')}
          />
        </SettingsSection>

        {/* ── Section 4: Security ── */}
        <SettingsSection title="Security">
          <SettingsRow
            icon="lock-closed-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Change Password"
            description="Update your login password"
            onPress={() => setChangePassVisible(true)}
          />
          <SettingsRow
            icon="call-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Phone Number"
            value={business?.phone}
            showChevron={false}
            description="To change your phone number contact support"
          />
        </SettingsSection>

        {/* ── Section 5: Notifications ── */}
        <SettingsSection title="Notifications">
          <SettingsRow
            icon="notifications-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Low Stock Alerts"
            description="Alert when products run low"
            showChevron={false}
            rightElement={
              <Switch
                value={lowStockAlertsEnabled}
                onValueChange={toggleLowStock}
                trackColor={{ false: '#DDE3F0', true: '#0047AB' }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingsRow
            icon="bar-chart-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Daily Summary"
            description="Remind me to review sales each evening"
            showChevron={false}
            rightElement={
              <Switch
                value={dailySummaryEnabled}
                onValueChange={toggleDailySummary}
                trackColor={{ false: '#DDE3F0', true: '#0047AB' }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </SettingsSection>

        {/* ── Section 6: Display ── */}
        <SettingsSection title="Display">
          <SettingsRow
            icon="cash-outline"
            iconColor="#0A7A4B"
            iconBackground="#EAF3DE"
            label="Primary Currency"
            value={business?.currency ?? 'USD'}
            onPress={() => setCurrencyVisible(true)}
          />
          <SettingsRow
            icon="calendar-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Date Format"
            value="3 Apr 2025"
            showChevron={false}
            description="DD MMM YYYY format"
          />
        </SettingsSection>

        {/* ── Section 7: About ── */}
        <SettingsSection title="About">
          <SettingsRow
            icon="information-circle-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="App Version"
            value="1.0.0"
            showChevron={false}
          />
          <SettingsRow
            icon="help-circle-outline"
            iconColor="#0047AB"
            iconBackground="#E6EEFF"
            label="Help & Support"
            description="WhatsApp support chat"
            onPress={() => {
              // TODO: Replace with your WhatsApp business number
              Linking.openURL('https://wa.me/YOUR_WHATSAPP_NUMBER')
            }}
          />
          <SettingsRow
            icon="shield-checkmark-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Privacy Policy"
            onPress={() => Linking.openURL('https://profitprotector.app/privacy')}
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor="#5A6A8A"
            iconBackground="#F4F6FB"
            label="Terms of Service"
            onPress={() => Linking.openURL('https://profitprotector.app/terms')}
          />
        </SettingsSection>

        {/* ── Section 8: Account ── */}
        <SettingsSection title="Account">
          <SettingsRow
            icon="log-out-outline"
            iconColor="#B45309"
            iconBackground="#FFF8F0"
            label="Sign Out"
            description="Your data stays saved in the cloud"
            onPress={handleSignOut}
          />
          <SettingsRow
            icon="trash-outline"
            destructive
            label="Delete Account"
            description="Permanently delete all data"
            onPress={handleDeleteAccount}
          />
        </SettingsSection>

        <View style={s.bottomPad} />
      </ScrollView>

      {/* ── Modals ── */}
      <EditBusinessModal visible={editBizVisible} onClose={() => setEditBizVisible(false)} />
      <CurrencyModal visible={currencyVisible} onClose={() => setCurrencyVisible(false)} />
      <ReceiptSettingsModal visible={receiptVisible} onClose={() => setReceiptVisible(false)} />
      <ChangePasswordModal visible={changePassVisible} onClose={() => setChangePassVisible(false)} />
      <DeleteConfirmModal visible={deleteVisible} onClose={() => setDeleteVisible(false)} />
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Hero
  hero: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
  },
  heroAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  heroName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 10,
    textAlign: 'center',
  },
  heroOwner: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginTop: 2,
  },
  heroPhone: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 2,
  },
  heroEditBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 6,
    marginTop: 12,
  },
  heroEditBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },

  // Stats
  statsCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#DDE3F0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#0D1B3E' },
  statLabel: { fontSize: 11, color: '#5A6A8A', marginTop: 2, textAlign: 'center' },
  statDivider: { width: 1, height: 36, backgroundColor: '#DDE3F0' },

  bottomPad: { height: 20 },
})
