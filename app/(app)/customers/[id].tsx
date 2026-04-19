import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Q } from '@nozbe/watermelondb'

import { ScreenHeader } from '../../../src/components/layout'
import { Badge, Button, Card, Divider, Input, LoadingScreen } from '../../../src/components/ui'
import { useCustomerDetail } from '../../../src/hooks/useCustomerDetail'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { useAuthStore } from '../../../src/stores/authStore'
import { formatCurrency, formatDate, formatPaymentMethod } from '../../../src/lib/formatters'
import { database } from '../../../src/database'
import type CustomerModel from '../../../src/database/models/Customer'
import type CreditSaleModel from '../../../src/database/models/CreditSale'
import type PaymentRecordModel from '../../../src/database/models/PaymentRecord'

// ---------------------------------------------------------------------------
// Avatar color helper
// ---------------------------------------------------------------------------

function getAvatarColors(name: string): { bg: string; text: string } {
  const code = name.charAt(0).toUpperCase().charCodeAt(0) - 65
  if (code <= 4) return { bg: '#E6EEFF', text: '#0047AB' }
  if (code <= 9) return { bg: '#EAF3DE', text: '#0A7A4B' }
  if (code <= 14) return { bg: '#FAEEDA', text: '#854F0B' }
  if (code <= 19) return { bg: '#FCEBEB', text: '#A32D2D' }
  return { bg: '#F0EEFF', text: '#4A3AA5' }
}

// ---------------------------------------------------------------------------
// Payment Method
// ---------------------------------------------------------------------------

type PayMethod = 'cash_usd' | 'cash_zig' | 'ecocash' | 'bank_transfer'

const PAY_METHODS: { id: PayMethod; label: string }[] = [
  { id: 'cash_usd', label: 'Cash $' },
  { id: 'cash_zig', label: 'Cash ZiG' },
  { id: 'ecocash', label: 'EcoCash' },
  { id: 'bank_transfer', label: 'Bank' },
]

// ---------------------------------------------------------------------------
// BottomSheet wrapper
// ---------------------------------------------------------------------------

interface BottomSheetProps {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
}

function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(800)).current

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start()
    } else {
      Animated.timing(slideAnim, {
        toValue: 800,
        duration: 220,
        useNativeDriver: true,
      }).start()
    }
  }, [visible, slideAnim])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavFull}
        >
          <Animated.View
            style={[
              styles.sheet,
              {
                transform: [{ translateY: slideAnim }],
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={styles.handleBar} />
              {children}
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// RecordPaymentModal
// ---------------------------------------------------------------------------

interface RecordPaymentModalProps {
  visible: boolean
  customerId: string
  customerName: string
  outstandingBalanceCents: number
  onClose: () => void
  onSuccess: (paidCents: number, newBalance: number) => void
}

function RecordPaymentModal({
  visible,
  customerId,
  customerName,
  outstandingBalanceCents,
  onClose,
  onSuccess,
}: RecordPaymentModalProps) {
  const [amount, setAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null)
  const [notes, setNotes] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [methodError, setMethodError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setAmount('')
      setPayMethod(null)
      setNotes('')
      setAmountError(null)
      setMethodError(null)
      setIsSaving(false)
    }
  }, [visible])

  const handleSave = useCallback(async () => {
    const parsedNum = parseFloat(amount)
    if (!amount.trim() || isNaN(parsedNum) || parsedNum <= 0) {
      setAmountError('Please enter an amount greater than 0')
      return
    }
    const parsedCents = Math.round(parsedNum * 100)
    if (parsedCents > outstandingBalanceCents) {
      setAmountError(
        `Amount cannot exceed outstanding balance of ${formatCurrency(outstandingBalanceCents)}`,
      )
      return
    }
    if (!payMethod) {
      setMethodError('Please select a payment method')
      return
    }
    if (!database) return

    setIsSaving(true)
    try {
      let actualPaidCents = 0
      let newBalance = 0

      await database.write(async () => {
        // 1. Fetch all unsettled credit_sales for ONLY this customer, oldest first
        const unsettled = await database!
          .get<CreditSaleModel>('credit_sales')
          .query(
            Q.where('customer_id', customerId),
            Q.where('is_settled', false),
            Q.sortBy('created_at', Q.asc),
          )
          .fetch()

        // 2. Track updated amounts per credit_sale to compute new balance correctly
        const updatedPaid = new Map<string, number>()

        let remaining = parsedCents
        for (const cs of unsettled) {
          if (remaining <= 0) break
          const previouslyPaid = cs.amountPaidCents
          const owed = cs.amountCents - previouslyPaid
          if (owed <= 0) continue
          const canPay = Math.min(remaining, owed)
          const newPaid = previouslyPaid + canPay
          updatedPaid.set(cs.id, newPaid)
          await cs.update((r) => {
            r.amountPaidCents = newPaid
            r.isSettled = newPaid >= cs.amountCents
          })
          remaining -= canPay
        }

        // actualPaidCents = what was actually distributed (parsedCents when valid)
        actualPaidCents = parsedCents - remaining

        // 3. Recompute the customer's outstanding balance from ALL their credit_sales
        //    by fetching fresh after updates.
        const allLines = await database!
          .get<CreditSaleModel>('credit_sales')
          .query(Q.where('customer_id', customerId))
          .fetch()

        newBalance = allLines.reduce((total, cs) => {
          const paid = updatedPaid.has(cs.id) ? updatedPaid.get(cs.id)! : cs.amountPaidCents
          return total + Math.max(0, cs.amountCents - paid)
        }, 0)

        // 4. Write corrected balance to customer row atomically
        const customerRecord = await database!
          .get<CustomerModel>('customers')
          .find(customerId)
        await customerRecord.update((c) => {
          c.outstandingBalanceCents = newBalance
          c.updatedAt = new Date(Date.now())
        })

        // 5. Create an immutable payment record for history
        await database!
          .get<PaymentRecordModel>('payment_records')
          .create((r) => {
            r.customerId = customerId
            r.amountCents = actualPaidCents
            r.paymentMethod = payMethod!
            r.notes = notes.trim() || null
          })
      })

      // Fire-and-forget sync
      const { triggerSync, business } = useAuthStore.getState()
      if (business) triggerSync(business.id).catch(() => {})

      onSuccess(actualPaidCents, newBalance)
    } catch {
      setIsSaving(false)
      Alert.alert('Error', 'Failed to record payment. Please try again.')
    }
  }, [amount, payMethod, notes, outstandingBalanceCents, customerId, onSuccess])

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.modalTitle}>Record Payment</Text>
        <Text style={styles.paymentSubtitle}>
          Outstanding: {formatCurrency(outstandingBalanceCents)}
        </Text>

        <View style={styles.modalFields}>
          <Input
            label="Amount Received"
            placeholder="0.00"
            value={amount}
            onChangeText={(t) => {
              setAmount(t)
              setAmountError(null)
            }}
            keyboardType="decimal-pad"
            error={amountError ?? undefined}
            hint={`Outstanding balance: ${formatCurrency(outstandingBalanceCents)}`}
            leftIcon={<Text style={styles.currencyPrefix}>$</Text>}
          />

          {/* Only Full shortcut */}
          <TouchableOpacity
            style={styles.fullPill}
            onPress={() => {
              setAmount((outstandingBalanceCents / 100).toFixed(2))
              setAmountError(null)
            }}
          >
            <Text style={styles.fullPillText}>Full amount</Text>
          </TouchableOpacity>

          {/* Payment method */}
          <Text style={styles.fieldLabel}>Payment Method</Text>
          <View style={styles.methodRow}>
            {PAY_METHODS.map((m) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => {
                  setPayMethod(m.id)
                  setMethodError(null)
                }}
                style={[
                  styles.methodPill,
                  payMethod === m.id && styles.methodPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.methodPillText,
                    payMethod === m.id && styles.methodPillTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {methodError != null && (
            <Text style={styles.errorText}>{methodError}</Text>
          )}

          <View style={{ height: 12 }} />
          <Input
            label="Notes (optional)"
            placeholder="e.g. Paid in full, received at shop"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
          />
        </View>

        <View style={styles.modalButtons}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" onPress={onClose} variant="ghost" size="md" />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Save Payment"
              onPress={handleSave}
              variant="primary"
              size="md"
              loading={isSaving}
            />
          </View>
        </View>
      </ScrollView>
    </BottomSheet>
  )
}

// ---------------------------------------------------------------------------
// EditCustomerModal
// ---------------------------------------------------------------------------

interface EditCustomerModalProps {
  visible: boolean
  customerId: string
  currentName: string
  currentPhone: string
  outstandingBalanceCents: number
  onClose: () => void
  onDeleted: () => void
}

function EditCustomerModal({
  visible,
  customerId,
  currentName,
  currentPhone,
  outstandingBalanceCents,
  onClose,
  onDeleted,
}: EditCustomerModalProps) {
  const [name, setName] = useState(currentName)
  const [phone, setPhone] = useState(currentPhone)
  const [nameError, setNameError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setName(currentName)
      setPhone(currentPhone)
      setNameError(null)
      setPhoneError(null)
      setIsSaving(false)
    }
  }, [visible, currentName, currentPhone])

  function validateName(n: string): string | null {
    if (!n.trim()) return 'Name is required'
    if (n.trim().length < 2) return 'Name must be at least 2 characters'
    if (n.trim().length > 60) return 'Name is too long'
    return null
  }

  function validatePhone(p: string): string | null {
    if (!p.trim()) return null
    if (p.trim().length !== 10) return 'Phone must be 10 digits'
    if (!p.trim().startsWith('07')) return 'Phone must start with 07'
    return null
  }

  const handleSave = useCallback(async () => {
    const nErr = validateName(name)
    const pErr = validatePhone(phone)
    setNameError(nErr)
    setPhoneError(pErr)
    if (nErr || pErr) return
    if (!database) return

    setIsSaving(true)
    try {
      await database.write(async () => {
        const record = await database!.get<CustomerModel>('customers').find(customerId)
        await record.update((c) => {
          c.name = name.trim()
          c.phone = phone.trim() || null
        })
      })
      const { triggerSync, business } = useAuthStore.getState()
      if (business) triggerSync(business.id).catch(() => {})
      onClose()
    } catch {
      setIsSaving(false)
      Alert.alert('Error', 'Failed to update customer. Please try again.')
    }
  }, [name, phone, customerId, onClose])

  const handleDelete = useCallback(() => {
    if (outstandingBalanceCents > 0) {
      Alert.alert(
        'Cannot Delete Customer',
        'Cannot delete a customer with an outstanding balance. Record a payment first.',
      )
      return
    }

    Alert.alert(
      `Delete ${currentName}?`,
      'This will not delete their sales history. Their credit records will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Customer',
          style: 'destructive',
          onPress: async () => {
            if (!database) return
            try {
              await database.write(async () => {
                const record = await database!.get<CustomerModel>('customers').find(customerId)
                await record.update((c) => { c.isActive = false })
              })
              const { triggerSync, business } = useAuthStore.getState()
              if (business) triggerSync(business.id).catch(() => {})
              onDeleted()
            } catch {
              Alert.alert('Error', 'Failed to delete customer.')
            }
          },
        },
      ],
    )
  }, [outstandingBalanceCents, currentName, customerId, onDeleted])

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.modalTitle}>Edit Customer</Text>
      <View style={styles.modalFields}>
        <Input
          label="Full Name"
          placeholder="e.g. Tendai Moyo"
          value={name}
          onChangeText={(t) => { setName(t); if (nameError) setNameError(null) }}
          autoCapitalize="words"
          maxLength={60}
          error={nameError ?? undefined}
          leftIcon={<Ionicons name="person-outline" size={18} color="#5A6A8A" />}
        />
        <View style={{ height: 12 }} />
        <Input
          label="Phone Number"
          placeholder="e.g. 0771234567"
          value={phone}
          onChangeText={(t) => { setPhone(t); if (phoneError) setPhoneError(null) }}
          keyboardType="phone-pad"
          error={phoneError ?? undefined}
          hint="Optional — used for WhatsApp receipts later"
          leftIcon={<Ionicons name="call-outline" size={18} color="#5A6A8A" />}
        />
      </View>
      <View style={styles.modalButtons}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" onPress={onClose} variant="ghost" size="md" />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save Changes" onPress={handleSave} variant="primary" size="md" loading={isSaving} />
        </View>
      </View>
      <TouchableOpacity onPress={handleDelete} style={styles.deleteLink}>
        <Text style={styles.deleteLinkText}>Delete Customer</Text>
      </TouchableOpacity>
    </BottomSheet>
  )
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ paidCents, totalCents }: { paidCents: number; totalCents: number }) {
  const pct = totalCents > 0 ? Math.min(1, paidCents / totalCents) : 0
  return (
    <View style={styles.progressBarBg}>
      <View style={[styles.progressBarFill, { width: `${pct * 100}%` }]} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// History section tab
// ---------------------------------------------------------------------------

type HistoryTab = 'credit' | 'payments'

// ---------------------------------------------------------------------------
// Customer Detail Screen
// ---------------------------------------------------------------------------

export default function CustomerDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const {
    customer,
    creditSales,
    paymentRecords,
    totalSpentCents,
    totalCreditCents,
    totalPaidBackCents,
    isLoading,
    error,
    refreshFromLocal,
  } = useCustomerDetail(id ?? '')

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      void refreshFromLocal()
    }, [refreshFromLocal]),
  )

  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [historyTab, setHistoryTab] = useState<HistoryTab>('credit')

  const isOwing = (customer?.outstandingBalanceCents ?? 0) > 0

  const handleCallCustomer = useCallback(() => {
    if (!customer?.phone) return
    Linking.openURL(`tel:${customer.phone}`)
  }, [customer?.phone])

  const handlePaymentSuccess = useCallback(
    (paidCents: number, newBalance: number) => {
      setShowPaymentModal(false)
      Alert.alert(
        'Payment Recorded',
        `${formatCurrency(paidCents)} received from ${customer?.name ?? 'customer'}.\n` +
          (newBalance > 0
            ? `Remaining balance: ${formatCurrency(newBalance)}`
            : 'Account fully settled!'),
      )
    },
    [customer?.name],
  )

  const handleDeleted = useCallback(() => {
    setShowEditModal(false)
    router.back()
  }, [])

  if (isLoading) return <LoadingScreen />

  if (error || !customer) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Customer"
          leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
          showBorder
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorMessage}>Customer not found.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const { bg, text } = getAvatarColors(customer.name)
  const initials = customer.name.slice(0, 2).toUpperCase()

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={customer.name}
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'create-outline', onPress: () => setShowEditModal(true) }}
        showBorder
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: isOwing ? 120 + insets.bottom : 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero card ── */}
        <Card style={styles.heroCard} padding="lg">
          <View style={styles.heroTopRow}>
            <View style={[styles.heroAvatar, { backgroundColor: bg }]}>
              <Text style={[styles.heroAvatarText, { color: text }]}>{initials}</Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroName}>{customer.name}</Text>
              {customer.phone ? (
                <TouchableOpacity style={styles.heroPhoneRow} onPress={handleCallCustomer} activeOpacity={0.7}>
                  <Ionicons name="call-outline" size={14} color="#5A6A8A" />
                  <Text style={styles.heroPhone}>{customer.phone}</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.heroAdded}>Added {formatDate(customer.createdAt)}</Text>
            </View>
          </View>

          <Divider />

          <View style={styles.balanceRow}>
            {isOwing ? (
              <>
                <Text style={styles.balanceLabel}>Outstanding Balance</Text>
                <Text style={styles.balanceAmount}>
                  {formatCurrency(customer.outstandingBalanceCents)}
                </Text>
                <View style={styles.recordPayBtn}>
                  <Button
                    label="Record Payment"
                    onPress={() => setShowPaymentModal(true)}
                    variant="primary"
                    size="sm"
                    fullWidth={false}
                    icon={<Ionicons name="cash-outline" size={16} color="#FFFFFF" />}
                  />
                </View>
              </>
            ) : (
              <View style={styles.settledState}>
                <Ionicons name="checkmark-circle" size={40} color="#0A7A4B" />
                <Text style={styles.settledTitle}>All settled up!</Text>
                <Text style={styles.settledSubtitle}>No outstanding balance</Text>
              </View>
            )}
          </View>
        </Card>

        {/* ── Overview stats ── */}
        <Text style={styles.sectionLabel}>Overview</Text>
        <Card padding="md" style={styles.sectionCard}>
          {[
            {
              label: 'Total Purchases',
              value: `${creditSales.length} sale${creditSales.length !== 1 ? 's' : ''}`,
            },
            { label: 'Total Spent', value: formatCurrency(totalSpentCents) },
            { label: 'Total Credit Taken', value: formatCurrency(totalCreditCents) },
            {
              label: 'Total Paid Back',
              value: formatCurrency(totalPaidBackCents),
              valueColor: '#0A7A4B',
            },
          ].map((row, idx, arr) => (
            <View
              key={row.label}
              style={[styles.statRow, idx < arr.length - 1 && styles.statRowBorder]}
            >
              <Text style={styles.statLabel}>{row.label}</Text>
              <Text style={[styles.statValue, row.valueColor ? { color: row.valueColor } : null]}>
                {row.value}
              </Text>
            </View>
          ))}
        </Card>

        {/* ── Tabbed history ── */}
        <View style={styles.historyTabBar}>
          <TouchableOpacity
            style={[styles.historyTab, historyTab === 'credit' && styles.historyTabActive]}
            onPress={() => setHistoryTab('credit')}
          >
            <Text
              style={[
                styles.historyTabText,
                historyTab === 'credit' && styles.historyTabTextActive,
              ]}
            >
              Credit History
              {creditSales.length > 0 ? ` (${creditSales.length})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.historyTab, historyTab === 'payments' && styles.historyTabActive]}
            onPress={() => setHistoryTab('payments')}
          >
            <Text
              style={[
                styles.historyTabText,
                historyTab === 'payments' && styles.historyTabTextActive,
              ]}
            >
              Payment History
              {paymentRecords.length > 0 ? ` (${paymentRecords.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Credit History content ── */}
        {historyTab === 'credit' && (
          <>
            {creditSales.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={styles.emptyHistoryText}>No credit sales yet</Text>
              </View>
            ) : (
              creditSales.map((cs) => (
                <TouchableOpacity
                  key={cs.id}
                  activeOpacity={0.92}
                  onPress={() =>
                    router.push({ pathname: '/(app)/sales/[id]', params: { id: cs.saleId } })
                  }
                  style={styles.historyCard}
                >
                  <View style={styles.historyHeaderRow}>
                    <Text style={styles.historyCardTitle}>
                      Sale #{cs.saleId.slice(-6).toUpperCase()}
                    </Text>
                    <Text
                      style={[
                        styles.historyCardAmount,
                        cs.isSettled ? styles.amountGreen : styles.amountRed,
                      ]}
                    >
                      {formatCurrency(cs.amountCents)}
                    </Text>
                  </View>
                  <View style={styles.historySubRow}>
                    <Text style={styles.historyDate}>{formatDate(cs.createdAt)}</Text>
                    <Badge
                      label={cs.isSettled ? 'Paid' : 'Owing'}
                      variant={cs.isSettled ? 'success' : 'danger'}
                      size="sm"
                    />
                  </View>
                  {!cs.isSettled && cs.amountPaidCents > 0 && (
                    <View style={styles.progressWrapper}>
                      <Text style={styles.progressLabel}>
                        Paid: {formatCurrency(cs.amountPaidCents)} of {formatCurrency(cs.amountCents)}
                      </Text>
                      <ProgressBar paidCents={cs.amountPaidCents} totalCents={cs.amountCents} />
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ── Payment History content ── */}
        {historyTab === 'payments' && (
          <>
            {paymentRecords.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={styles.emptyHistoryText}>No payments recorded yet</Text>
              </View>
            ) : (
              paymentRecords.map((pr) => (
                <View key={pr.id} style={styles.historyCard}>
                  <View style={styles.historyHeaderRow}>
                    <View style={styles.paymentIconRow}>
                      <Ionicons name="cash-outline" size={16} color="#0A7A4B" />
                      <Text style={styles.paymentMethodLabel}>
                        {formatPaymentMethod(pr.paymentMethod)}
                      </Text>
                    </View>
                    <Text style={[styles.historyCardAmount, styles.amountGreen]}>
                      {formatCurrency(pr.amountCents)}
                    </Text>
                  </View>
                  <View style={styles.historySubRow}>
                    <Text style={styles.historyDate}>{formatDate(pr.createdAt)}</Text>
                    <Badge label="Paid" variant="success" size="sm" />
                  </View>
                  {pr.notes ? (
                    <Text style={styles.paymentNotes}>{pr.notes}</Text>
                  ) : null}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* ── Fixed bottom bar ── */}
      {isOwing && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={{ flex: 1 }}>
            <Button
              label="Call Customer"
              onPress={handleCallCustomer}
              variant="secondary"
              size="md"
              disabled={!customer.phone}
              icon={<Ionicons name="call-outline" size={18} color="#0047AB" />}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Record Payment"
              onPress={() => setShowPaymentModal(true)}
              variant="primary"
              size="md"
              icon={<Ionicons name="cash-outline" size={18} color="#FFFFFF" />}
            />
          </View>
        </View>
      )}

      {/* ── Modals ── */}
      <RecordPaymentModal
        visible={showPaymentModal}
        customerId={customer.id}
        customerName={customer.name}
        outstandingBalanceCents={customer.outstandingBalanceCents}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handlePaymentSuccess}
      />

      <EditCustomerModal
        visible={showEditModal}
        customerId={customer.id}
        currentName={customer.name}
        currentPhone={customer.phone ?? ''}
        outstandingBalanceCents={customer.outstandingBalanceCents}
        onClose={() => setShowEditModal(false)}
        onDeleted={handleDeleted}
      />
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6FB' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorMessage: { fontSize: 16, color: '#5A6A8A' },

  // Hero
  heroCard: { marginBottom: 16 },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroAvatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  heroAvatarText: { fontSize: 20, fontWeight: '700' },
  heroInfo: { flex: 1, marginLeft: 14 },
  heroName: { fontSize: 20, fontWeight: '700', color: '#0D1B3E' },
  heroPhoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  heroPhone: { fontSize: 13, color: '#5A6A8A' },
  heroAdded: { fontSize: 12, color: '#5A6A8A', marginTop: 2 },
  balanceRow: { alignItems: 'center', paddingVertical: 8 },
  balanceLabel: { fontSize: 12, color: '#5A6A8A', textAlign: 'center', marginBottom: 4 },
  balanceAmount: { fontSize: 32, fontWeight: '700', color: '#C0152A', textAlign: 'center' },
  recordPayBtn: { marginTop: 12 },
  settledState: { alignItems: 'center', paddingVertical: 4 },
  settledTitle: { fontSize: 16, fontWeight: '600', color: '#0A7A4B', marginTop: 8, textAlign: 'center' },
  settledSubtitle: { fontSize: 13, color: '#5A6A8A', textAlign: 'center' },

  // Stats
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: '#5A6A8A',
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingBottom: 8, marginTop: 4,
  },
  sectionCard: { marginBottom: 16 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  statRowBorder: { borderBottomWidth: 0.5, borderBottomColor: '#F4F6FB' },
  statLabel: { fontSize: 14, color: '#5A6A8A' },
  statValue: { fontSize: 14, fontWeight: '600', color: '#0D1B3E' },

  // History tabs
  historyTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE3F0',
    marginBottom: 12,
  },
  historyTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  historyTabActive: { borderBottomColor: '#0047AB' },
  historyTabText: { fontSize: 13, fontWeight: '500', color: '#5A6A8A' },
  historyTabTextActive: { color: '#0047AB', fontWeight: '600' },

  // History cards
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  historyHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyCardTitle: { fontSize: 14, fontWeight: '600', color: '#0D1B3E' },
  historyCardAmount: { fontSize: 15, fontWeight: '700' },
  amountRed: { color: '#C0152A' },
  amountGreen: { color: '#0A7A4B' },
  historySubRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 4,
  },
  historyDate: { fontSize: 12, color: '#5A6A8A' },
  progressWrapper: { marginTop: 8 },
  progressLabel: { fontSize: 12, color: '#5A6A8A', marginBottom: 4 },
  progressBarBg: { height: 4, borderRadius: 2, backgroundColor: '#DDE3F0', overflow: 'hidden' },
  progressBarFill: { height: 4, borderRadius: 2, backgroundColor: '#0047AB' },
  emptyHistory: { alignItems: 'center', paddingVertical: 20 },
  emptyHistoryText: { fontSize: 13, color: '#5A6A8A' },

  // Payment history row
  paymentIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paymentMethodLabel: { fontSize: 14, fontWeight: '600', color: '#0D1B3E' },
  paymentNotes: { fontSize: 12, color: '#5A6A8A', marginTop: 6, fontStyle: 'italic' },

  // Bottom bar
  bottomBar: {
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#DDE3F0',
    paddingTop: 12, paddingHorizontal: 16, flexDirection: 'row', gap: 12,
  },

  // Overlay / sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  kavFull: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, maxHeight: '90%',
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDE3F0',
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0D1B3E', marginBottom: 4 },
  paymentSubtitle: { fontSize: 13, color: '#C0152A', marginBottom: 16 },
  modalFields: { width: '100%' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 4 },

  // Full amount pill
  fullPill: {
    backgroundColor: '#E6EEFF', borderRadius: 999,
    paddingVertical: 6, paddingHorizontal: 16,
    alignSelf: 'flex-start', marginTop: 10, marginBottom: 16,
  },
  fullPillText: { fontSize: 12, fontWeight: '500', color: '#0047AB' },

  // Payment method pills
  fieldLabel: { fontSize: 14, color: '#1A202C', fontWeight: '500', marginBottom: 8 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodPill: {
    borderWidth: 1, borderColor: '#DDE3F0', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FFFFFF',
  },
  methodPillActive: { backgroundColor: '#0047AB', borderColor: '#0047AB' },
  methodPillText: { fontSize: 13, color: '#5A6A8A', fontWeight: '500' },
  methodPillTextActive: { color: '#FFFFFF' },
  errorText: { fontSize: 12, color: '#C0152A', marginTop: 4 },
  currencyPrefix: { fontSize: 16, color: '#5A6A8A' },

  // Edit delete link
  deleteLink: { alignItems: 'center', paddingVertical: 14 },
  deleteLinkText: { fontSize: 13, color: '#C0152A', textAlign: 'center' },
})
