import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'

import { Button, Input } from '../ui'
import { AddRecoveryEmailModal } from './AddRecoveryEmailModal'
import { ChangePasswordModal } from './ChangePasswordModal'
import { ModalSheet, modalSheetStyles as ms } from './ModalSheet'
import { useAuthStore } from '../../stores/authStore'
import type { BusinessInfo } from '../../stores/authStore'
import { database } from '../../database'
import Business from '../../database/models/Business'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLogger'
import {
  getBusinessLogoDisplayUri,
  pickAndSaveBusinessLogoFromDevice,
  removeBusinessLogo,
} from '../../lib/businessLogo'

interface ReceiptSettings {
  businessName: string
  footer: string
  prefix: string
}

const BUSINESS_TYPES = [
  'Retail Shop',
  'Hardware',
  'Salon/Barber',
  'Restaurant/Takeaway',
  'Pharmacy',
  'Other',
]

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)', description: 'All prices shown in US Dollars' },
  { value: 'ZiG', label: 'ZiG', description: 'All prices shown in Zimbabwe Gold' },
  { value: 'Both', label: 'Both', description: 'Show prices in both USD and ZiG' },
]

function EditBusinessModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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

      await supabase
        .from('businesses')
        .update({
          name: name.trim(),
          owner_name: ownerName.trim(),
          business_type: businessType,
        })
        .eq('id', business.id)

      setBusiness({ ...business, name: name.trim(), ownerName: ownerName.trim(), businessType })
      await logActivity({
        action: 'business_profile_updated',
        entityType: 'business',
        entityId: business.id,
        entityName: name.trim(),
      })
      onClose()
    } catch {
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
            {errors.businessType ? <Text style={eb.typeError}>{errors.businessType}</Text> : null}
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

function CurrencyModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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

function ReceiptSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
      const payload = JSON.stringify({ businessName: bizName, footer, prefix })
      if (__DEV__) {
        const n = new TextEncoder().encode(payload).length
        console.log(`[SecureStore] receipt_settings ${n} bytes`)
        if (n > 2000) {
          console.warn('[SecureStore] receipt_settings exceeds 2KB; split storage if this is expected')
        }
      }
      await SecureStore.setItemAsync('receipt_settings', payload)
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
            hint="Optional label only — receipt numbers are auto (e.g. RCP-001AAA)"
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

function BusinessLogoModal({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [previewUri, setPreviewUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (visible) {
      setPreviewUri(getBusinessLogoDisplayUri())
    }
  }, [visible])

  const handleChoose = async () => {
    if (busy) return
    setBusy(true)
    try {
      await pickAndSaveBusinessLogoFromDevice()
      onChanged()
      setPreviewUri(getBusinessLogoDisplayUri())
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      if (msg === 'No image selected') return
      Alert.alert('Error', msg || 'Could not save logo.')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = () => {
    if (!previewUri) return
    Alert.alert('Remove logo?', 'Reports and receipts will no longer show your logo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeBusinessLogo()
          setPreviewUri(null)
          onChanged()
        },
      },
    ])
  }

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Business Logo">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={bl.hint}>
          Optional image shown at the top of PDF reports and printed or shared receipts. You will be asked to pick an
          image file (JPG, PNG, or WebP) from your device. Preferably without a background for the best results.
        </Text>
        <View style={bl.previewBox}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={bl.previewImg} resizeMode="contain" />
          ) : (
            <Text style={bl.previewPlaceholder}>No logo yet — tap Choose Image</Text>
          )}
        </View>
        <View style={bl.actions}>
          <Button
            label={busy ? 'Working...' : 'Choose Image'}
            onPress={handleChoose}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={busy}
          />
          {previewUri ? (
            <Button
              label="Remove Logo"
              onPress={handleRemove}
              variant="danger"
              size="lg"
              fullWidth
              disabled={busy}
            />
          ) : null}
          <Button label="Done" onPress={onClose} variant="secondary" size="lg" fullWidth disabled={busy} />
        </View>
      </ScrollView>
    </ModalSheet>
  )
}

function DeleteConfirmModal({
  visible,
  onClose,
  businessId,
}: {
  visible: boolean
  onClose: () => void
  businessId: string | null
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
      const { deleteAccountFully } = await import('../../lib/accountLifecycle')
      const result = await deleteAccountFully(businessId)
      if (!result.ok) {
        Alert.alert('Could not delete account', result.message)
        setDeleting(false)
        return
      }
      await logout()
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

function ClearDataConfirmModal({
  visible,
  onClose,
  userId,
  businessId,
}: {
  visible: boolean
  onClose: () => void
  userId: string
  businessId: string
}) {
  const [inputValue, setInputValue] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!visible) setInputValue('')
  }, [visible])

  const handleClear = async () => {
    if (inputValue !== 'CLEAR') return
    setWorking(true)
    try {
      const { clearBusinessDataEverywhere } = await import('../../lib/accountLifecycle')
      const result = await clearBusinessDataEverywhere(userId, businessId)
      if (!result.ok) {
        Alert.alert('Could not clear data', result.message)
        setWorking(false)
        return
      }
      Alert.alert('Data cleared', 'Your products, sales, stock history, and customers were removed.')
      onClose()
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  const canSubmit = inputValue === 'CLEAR'

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={ms.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.root}>
          <TouchableOpacity style={ms.overlay} activeOpacity={1} onPress={onClose} />
          <View style={dc.sheet}>
            <View style={ms.handle} />
            <View style={cc.iconWrap}>
              <Ionicons name="layers-outline" size={32} color="#0047AB" />
            </View>
            <Text style={cc.title}>Clear All Business Data</Text>
            <Text style={dc.body}>
              This removes all products, sales, stock movements, and customers from this device and
              from your cloud backup. Your sign-in and business profile (name, phone, currency) stay
              the same.
            </Text>
            <Text style={dc.label}>Type CLEAR to confirm</Text>
            <TextInput
              style={[dc.input, canSubmit && cc.inputReady]}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder="CLEAR"
              placeholderTextColor="#AABBCC"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!working}
            />
            <TouchableOpacity
              style={[cc.clearBtn, !canSubmit && cc.clearBtnDisabled]}
              onPress={handleClear}
              disabled={!canSubmit || working}
            >
              {working ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={cc.clearBtnText}>Clear All Data</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={dc.cancelBtn} onPress={onClose} disabled={working}>
              <Text style={dc.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export type SettingsOwnerModalsProps = {
  editBizVisible: boolean
  onCloseEditBiz: () => void
  currencyVisible: boolean
  onCloseCurrency: () => void
  receiptVisible: boolean
  onCloseReceipt: () => void
  logoModalVisible: boolean
  onCloseLogo: () => void
  onLogoChanged: () => void
  addEmailVisible: boolean
  onCloseAddEmail: () => void
  changePassVisible: boolean
  onCloseChangePass: () => void
  deleteVisible: boolean
  onCloseDelete: () => void
  clearDataVisible: boolean
  onCloseClearData: () => void
  business: BusinessInfo | null
  user: { id: string } | null
  setBusiness: (business: BusinessInfo) => void
}

export function SettingsOwnerModals({
  editBizVisible,
  onCloseEditBiz,
  currencyVisible,
  onCloseCurrency,
  receiptVisible,
  onCloseReceipt,
  logoModalVisible,
  onCloseLogo,
  onLogoChanged,
  addEmailVisible,
  onCloseAddEmail,
  changePassVisible,
  onCloseChangePass,
  deleteVisible,
  onCloseDelete,
  clearDataVisible,
  onCloseClearData,
  business,
  user,
  setBusiness,
}: SettingsOwnerModalsProps) {
  return (
    <>
      {editBizVisible ? <EditBusinessModal visible onClose={onCloseEditBiz} /> : null}
      {currencyVisible ? <CurrencyModal visible onClose={onCloseCurrency} /> : null}
      {receiptVisible ? <ReceiptSettingsModal visible onClose={onCloseReceipt} /> : null}
      {logoModalVisible ? (
        <BusinessLogoModal visible onClose={onCloseLogo} onChanged={onLogoChanged} />
      ) : null}
      {addEmailVisible && business != null && user != null ? (
        <AddRecoveryEmailModal
          visible
          onClose={onCloseAddEmail}
          business={business}
          userId={user.id}
          setBusiness={setBusiness}
        />
      ) : null}
      {changePassVisible && business != null ? (
        <ChangePasswordModal visible onClose={onCloseChangePass} business={business} />
      ) : null}
      {deleteVisible ? (
        <DeleteConfirmModal visible onClose={onCloseDelete} businessId={business?.id ?? null} />
      ) : null}
      {clearDataVisible && user != null && business != null ? (
        <ClearDataConfirmModal
          visible
          onClose={onCloseClearData}
          userId={user.id}
          businessId={business.id}
        />
      ) : null}
    </>
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

const rs = StyleSheet.create({
  fields: { gap: 16 },
  actions: { marginTop: 24, marginBottom: 8 },
})

const bl = StyleSheet.create({
  hint: { fontSize: 14, color: '#5A6A8A', lineHeight: 20, marginBottom: 16 },
  previewBox: {
    minHeight: 140,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DDE3F0',
    backgroundColor: '#F4F6FB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    marginBottom: 8,
  },
  previewImg: { width: '100%', height: 120 },
  previewPlaceholder: { fontSize: 14, color: '#AABBCC', textAlign: 'center' },
  actions: { gap: 10, marginTop: 16, marginBottom: 8 },
})

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

const cc = StyleSheet.create({
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0047AB', textAlign: 'center', marginBottom: 8 },
  inputReady: { borderColor: '#0047AB' },
  clearBtn: {
    backgroundColor: '#0047AB',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  clearBtnDisabled: { backgroundColor: '#A0B0CC' },
  clearBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
})
