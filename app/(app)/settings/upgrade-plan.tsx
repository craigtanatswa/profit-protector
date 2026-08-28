import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  AppState,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { WebView } from 'react-native-webview'

import { Button, Card, Input } from '../../../src/components/ui'
import { ScreenHeader } from '../../../src/components/layout/ScreenHeader'
import { useAuthStore } from '../../../src/stores/authStore'
import { useSubscription } from '../../../src/hooks/useSubscription'
import {
  confirmFreeUpgrade,
  initiateCardPayment,
  initiateEcocashPayment,
  initiateInnbucksPayment,
  initiateOnemoneyPayment,
  pollPaymentStatus,
} from '../../../src/lib/subscription'
import { formatPlanPrice, PRO_PLUS_VALUE } from '../../../src/lib/plans'

// ── Theme ────────────────────────────────────────────────────────────────────

const C = {
  primary: '#0047AB',
  background: '#F4F6FB',
  card: '#FFFFFF',
  border: '#DDE3F0',
  text: '#0D1B3E',
  muted: '#5A6A8A',
  success: '#0A7A4B',
  successLight: '#EAF3DE',
  danger: '#C0152A',
  purple: '#7C3AED',
  purpleLight: '#F3EEFF',
  purpleBorder: '#D4B8FF',
}

type PaymentMethodKey = 'ecocash' | 'onemoney' | 'innbucks' | 'card'
type UpgradeState = 'idle' | 'confirming' | 'initiated' | 'polling' | 'success' | 'failed'

const METHOD_LABELS: Record<PaymentMethodKey, string> = {
  ecocash: 'EcoCash',
  onemoney: 'OneMoney',
  innbucks: 'InnBucks',
  card: 'Card',
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function RotatingSpinner({ size = 32, color = C.purple }: { size?: number; color?: string }) {
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={size} color={color} />
    </Animated.View>
  )
}

// ── Method Card ───────────────────────────────────────────────────────────────

function MethodCard({
  method,
  selected,
  onPress,
}: {
  method: PaymentMethodKey
  selected: boolean
  onPress: () => void
}) {
  const icons: Record<PaymentMethodKey, keyof typeof Ionicons.glyphMap> = {
    ecocash: 'phone-portrait-outline',
    onemoney: 'phone-portrait-outline',
    innbucks: 'wallet-outline',
    card: 'card-outline',
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.methodCard, selected && styles.methodCardSelected]}
      activeOpacity={0.75}
    >
      <Ionicons name={icons[method]} size={22} color={selected ? C.purple : C.muted} />
      <Text style={[styles.methodLabel, selected && styles.methodLabelSelected]}>{METHOD_LABELS[method]}</Text>
      {selected && <View style={styles.methodDot} />}
    </TouchableOpacity>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function UpgradePlanScreen() {
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const { subscription, upgradeProration, canUpgrade, refetch } = useSubscription()

  const [state, setState] = useState<UpgradeState>('idle')
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodKey>('ecocash')
  const [phone, setPhone] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [pollUrl, setPollUrl] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const [innbucksCode, setInnbucksCode] = useState('')
  const [innbucksDeepLink, setInnbucksDeepLink] = useState('')
  const [cardRedirectUrl, setCardRedirectUrl] = useState('')
  const [showWebView, setShowWebView] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const appSubRef = useRef<{ remove: () => void } | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)

  const authEmail = user?.email ?? business?.recoveryEmail ?? 'noreply@profitprotector.app'
  const businessId = business?.id ?? ''

  const proration = upgradeProration
  const isFree = proration?.isFree ?? false

  // ── Polling ─────────────────────────────────────────────────────────────────

  const startPolling = useCallback(
    (pid: string, pUrl: string) => {
      let attempts = 0
      const MAX_ATTEMPTS = 60
      let cancelled = false

      const tick = async () => {
        if (cancelled) return
        attempts++
        try {
          const result = await pollPaymentStatus(pid, pUrl)
          if (result.isPaid) {
            cancelled = true
            if (pollingRef.current) clearInterval(pollingRef.current)
            await refetch()
            setState('success')
            return
          }
          const status = (result.status ?? '').toLowerCase()
          if (status === 'cancelled' || status === 'disputed' || status === 'failed') {
            cancelled = true
            if (pollingRef.current) clearInterval(pollingRef.current)
            setState('failed')
            setErrorMsg('Payment was cancelled or disputed.')
            return
          }
          if (attempts >= MAX_ATTEMPTS) {
            cancelled = true
            if (pollingRef.current) clearInterval(pollingRef.current)
            setState('failed')
            setErrorMsg('Payment timed out. If you completed the payment, do not pay again — contact support.')
          }
        } catch (e) {
          console.warn('Upgrade poll error:', e)
        }
      }

      void tick()
      pollingRef.current = setInterval(() => {
        void tick()
      }, 4000)

      appSubRef.current?.remove()
      appSubRef.current = AppState.addEventListener('change', (state) => {
        if (state === 'active') void tick()
      })
    },
    [refetch],
  )

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      appSubRef.current?.remove()
    }
  }, [])

  // ── Validation ───────────────────────────────────────────────────────────────

  function validatePhone(): boolean {
    const cleaned = phone.trim()
    if (!cleaned) { setPhoneErr('Phone number is required'); return false }
    if (!/^0\d{9}$/.test(cleaned)) { setPhoneErr('Enter a valid Zimbabwean number (e.g. 0771234567)'); return false }
    setPhoneErr('')
    return true
  }

  // ── Free upgrade ─────────────────────────────────────────────────────────────

  async function handleFreeUpgrade() {
    if (!businessId) return
    setState('confirming')
    try {
      const result = await confirmFreeUpgrade(businessId)
      if (result.freeUpgrade) {
        await refetch()
        setState('success')
      } else {
        setState('failed')
        setErrorMsg(result.message ?? 'Upgrade failed. Please try again.')
      }
    } catch (e) {
      setState('failed')
      setErrorMsg('An unexpected error occurred. Please try again.')
    }
  }

  // ── Paid upgrade ─────────────────────────────────────────────────────────────

  async function handlePay() {
    if (!businessId) return

    const needsPhone = selectedMethod === 'ecocash' || selectedMethod === 'onemoney'
    if (needsPhone && !validatePhone()) return

    setState('initiated')
    setErrorMsg('')

    try {
      let result
      if (selectedMethod === 'ecocash') {
        result = await initiateEcocashPayment({ businessId, phoneNumber: phone.trim(), authEmail, planTier: 'pro_plus', isUpgrade: true })
      } else if (selectedMethod === 'onemoney') {
        result = await initiateOnemoneyPayment({ businessId, phoneNumber: phone.trim(), authEmail, planTier: 'pro_plus', isUpgrade: true })
      } else if (selectedMethod === 'innbucks') {
        result = await initiateInnbucksPayment({ businessId, authEmail, planTier: 'pro_plus', isUpgrade: true })
      } else {
        result = await initiateCardPayment({ businessId, authEmail, planTier: 'pro_plus', isUpgrade: true })
      }

      if (!result.success) {
        setState('failed')
        setErrorMsg(result.message ?? 'Payment initiation failed.')
        return
      }

      // Free upgrade path returned from server unexpectedly (proration < $0.50)
      if (result.freeUpgrade) {
        await refetch()
        setState('success')
        return
      }

      if (selectedMethod === 'card' && result.redirectUrl) {
        setCardRedirectUrl(result.redirectUrl)
        setShowWebView(true)
        if (result.paymentId) setPaymentId(result.paymentId)
        if (result.pollUrl) { setPollUrl(result.pollUrl); setState('polling'); startPolling(result.paymentId!, result.pollUrl) }
        return
      }

      if (selectedMethod === 'innbucks') {
        if (result.authorizationCode) setInnbucksCode(result.authorizationCode)
        if (result.deepLink) setInnbucksDeepLink(result.deepLink)
      }

      if (result.paymentId && result.pollUrl) {
        setPaymentId(result.paymentId)
        setPollUrl(result.pollUrl)
        setState('polling')
        startPolling(result.paymentId, result.pollUrl)
      }
    } catch {
      setState('failed')
      setErrorMsg('An unexpected error occurred. Please check your connection and try again.')
    }
  }

  // ── Computed display values ───────────────────────────────────────────────────

  const chargeCents = proration?.chargeCents ?? 0
  const chargeDisplay = isFree ? 'Free' : `$${(chargeCents / 100).toFixed(2)}`
  const creditDisplay = `$${((proration?.creditCents ?? 0) / 100).toFixed(2)}`
  const newCostDisplay = `$${((proration?.prosPlusCostCents ?? 0) / 100).toFixed(2)}`
  const daysRemaining = proration?.daysRemaining ?? 0
  const nextBillingDate = subscription?.nextBillingDate
    ? new Date(subscription.nextBillingDate).toLocaleDateString('en-ZW', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  // ── Card webview handler ──────────────────────────────────────────────────────

  if (showWebView && cardRedirectUrl) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.webViewHeader}>
          <TouchableOpacity onPress={() => setShowWebView(false)} style={styles.webViewBack}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.webViewTitle}>Card Payment</Text>
        </View>
        <WebView source={{ uri: cardRedirectUrl }} style={{ flex: 1 }} />
      </SafeAreaView>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────────

  if (state === 'success') {
    return (
      <SafeAreaView style={styles.root}>
        <ScreenHeader
          title="Upgrade to Pro+"
          leftAction={{ icon: 'close', onPress: () => router.back() }}
        />
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={C.success} />
          </View>
          <Text style={styles.successTitle}>You're on Pro+!</Text>
          <Text style={styles.successBody}>
            You can now run {PRO_PLUS_VALUE}.
          </Text>
          <View style={styles.successCard}>
            <Text style={styles.successCardLabel}>Next renewal</Text>
            <Text style={styles.successCardValue}>{nextBillingDate}</Text>
            <Text style={[styles.successCardLabel, { marginTop: 6 }]}>Monthly price</Text>
            <Text style={styles.successCardValue}>{formatPlanPrice('pro_plus')}</Text>
          </View>
          <View style={{ marginTop: 24 }}><Button label="Done" onPress={() => router.back()} /></View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Polling / Initiated ───────────────────────────────────────────────────────

  if (state === 'polling' || state === 'initiated') {
    return (
      <SafeAreaView style={styles.root}>
        <ScreenHeader
          title="Upgrade to Pro+"
          leftAction={{ icon: 'close', onPress: () => router.back() }}
        />
        <View style={styles.pollingContainer}>
          <RotatingSpinner size={48} />
          <Text style={styles.pollingTitle}>
            {state === 'initiated' ? 'Sending payment request…' : 'Waiting for payment…'}
          </Text>
          {selectedMethod === 'ecocash' && (
            <Text style={styles.pollingHint}>Check your phone and enter your EcoCash PIN.</Text>
          )}
          {selectedMethod === 'onemoney' && (
            <Text style={styles.pollingHint}>Check your phone and enter your OneMoney PIN.</Text>
          )}
          {selectedMethod === 'innbucks' && innbucksCode !== '' && (
            <View style={styles.innbucksBox}>
              <Text style={styles.innbucksLabel}>Authorization code</Text>
              <Text style={styles.innbucksCode}>{innbucksCode}</Text>
              {innbucksDeepLink !== '' && (
                <TouchableOpacity onPress={() => Linking.openURL(innbucksDeepLink)} style={styles.openAppBtn}>
                  <Text style={styles.openAppText}>Open InnBucks App</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={styles.pollingNote}>This page will update automatically after you enter your PIN.</Text>
          <View style={{ marginTop: 16, width: '100%' }}>
            <Button
              label="Check payment status"
              onPress={async () => {
                if (!paymentId || !pollUrl) return
                setIsCheckingStatus(true)
                try {
                  const result = await pollPaymentStatus(paymentId, pollUrl)
                  if (result.isPaid) {
                    if (pollingRef.current) clearInterval(pollingRef.current)
                    await refetch()
                    setState('success')
                  } else if (['cancelled', 'disputed', 'failed'].includes((result.status ?? '').toLowerCase())) {
                    if (pollingRef.current) clearInterval(pollingRef.current)
                    setState('failed')
                    setErrorMsg('Payment was cancelled or disputed.')
                  } else {
                    Alert.alert(
                      'Payment pending',
                      'Paynow has not confirmed this payment yet. If you already entered your PIN, wait a moment and try again. Do not pay twice.',
                    )
                  }
                } catch (e) {
                  Alert.alert(
                    'Could not check payment',
                    e instanceof Error ? e.message : 'Please try again.',
                  )
                } finally {
                  setIsCheckingStatus(false)
                }
              }}
              loading={isCheckingStatus}
              disabled={isCheckingStatus}
            />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Failed ────────────────────────────────────────────────────────────────────

  if (state === 'failed') {
    return (
      <SafeAreaView style={styles.root}>
        <ScreenHeader
          title="Upgrade to Pro+"
          leftAction={{ icon: 'close', onPress: () => router.back() }}
        />
        <View style={styles.pollingContainer}>
          <Ionicons name="close-circle" size={56} color={C.danger} />
          <Text style={styles.failedTitle}>Upgrade Failed</Text>
          <Text style={styles.failedMsg}>{errorMsg}</Text>
          <View style={{ marginTop: 24 }}><Button label="Try Again" onPress={() => setState('idle')} /></View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Idle (main view) ──────────────────────────────────────────────────────────

  if (!canUpgrade || !proration) {
    return (
      <SafeAreaView style={styles.root}>
        <ScreenHeader
          title="Upgrade to Pro+"
          leftAction={{ icon: 'close', onPress: () => router.back() }}
        />
        <View style={styles.pollingContainer}>
          <Ionicons name="information-circle-outline" size={48} color={C.muted} />
          <Text style={styles.pollingTitle}>Upgrade unavailable</Text>
          <Text style={styles.pollingHint}>
            {subscription?.planTier === 'pro_plus'
              ? "You're already on the Pro+ plan."
              : 'You need an active Pro subscription to upgrade.'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScreenHeader
        title="Upgrade to Pro+"
        leftAction={{ icon: 'close', onPress: () => router.back() }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Plan comparison */}
          <View style={styles.planRow}>
            <View style={[styles.planBadge, styles.planBadgePro]}>
              <Text style={styles.planBadgeText}>Pro</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={C.muted} />
            <View style={[styles.planBadge, styles.planBadgeProPlus]}>
              <Text style={[styles.planBadgeText, styles.planBadgeTextProPlus]}>Pro+</Text>
            </View>
          </View>

          {/* Proration breakdown */}
          <Card padding="md" style={styles.prorationCard}>
            <Text style={styles.prorationTitle}>What you pay today</Text>

            <View style={styles.prorationRow}>
              <Text style={styles.prorationLabel}>Days remaining this period</Text>
              <Text style={styles.prorationValue}>{daysRemaining} days</Text>
            </View>
            <View style={styles.prorationDivider} />
            <View style={styles.prorationRow}>
              <Text style={styles.prorationLabel}>Credit (unused Pro time)</Text>
              <Text style={[styles.prorationValue, styles.prorationCredit]}>–{creditDisplay}</Text>
            </View>
            <View style={styles.prorationRow}>
              <Text style={styles.prorationLabel}>Pro+ cost for {daysRemaining} days</Text>
              <Text style={styles.prorationValue}>+{newCostDisplay}</Text>
            </View>
            <View style={styles.prorationDivider} />
            <View style={styles.prorationRow}>
              <Text style={styles.prorationTotal}>You pay today</Text>
              <Text style={[styles.prorationTotal, styles.prorationTotalAmount]}>
                {isFree ? 'Free' : chargeDisplay}
              </Text>
            </View>
            {isFree && (
              <Text style={styles.prorationFreeNote}>
                Less than $0.50 remaining — upgrade is free!
              </Text>
            )}
            <View style={styles.prorationDivider} />
            <View style={styles.prorationRow}>
              <Text style={styles.prorationLabel}>Future monthly renewals</Text>
              <Text style={styles.prorationValue}>{formatPlanPrice('pro_plus')} / mo</Text>
            </View>
            <Text style={styles.prorationRenewal}>Next renewal: {nextBillingDate}</Text>
          </Card>

          {/* Feature highlight */}
          <View style={styles.featureBlock}>
            <View style={styles.featureRow}>
              <Ionicons name="storefront-outline" size={18} color={C.purple} />
              <Text style={styles.featureText}>Up to 5 shops — each with its own stock and sales</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="cut-outline" size={18} color={C.purple} />
              <Text style={styles.featureText}>Cut-to-order stock for meat, cloth, and similar</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="people-outline" size={18} color={C.purple} />
              <Text style={styles.featureText}>Up to 5 staff accounts, assigned to a shop</Text>
            </View>
          </View>

          {isFree ? (
            /* Free upgrade — single confirm button */
            <View style={styles.upgradeBtn}>
              <Button
                label="Confirm Free Upgrade to Pro+"
                onPress={handleFreeUpgrade}
                loading={state === 'confirming'}
                disabled={state === 'confirming'}
              />
            </View>
          ) : (
            /* Paid upgrade — payment method selection */
            <>
              <Text style={styles.sectionLabel}>Select payment method</Text>
              <View style={styles.methodGrid}>
                {(['ecocash', 'onemoney', 'innbucks', 'card'] as PaymentMethodKey[]).map((m) => (
                  <MethodCard key={m} method={m} selected={selectedMethod === m} onPress={() => setSelectedMethod(m)} />
                ))}
              </View>

              {(selectedMethod === 'ecocash' || selectedMethod === 'onemoney') && (
                <Input
                  label="Mobile number"
                  placeholder="0771234567"
                  value={phone}
                  onChangeText={(t) => { setPhone(t); setPhoneErr('') }}
                  keyboardType="phone-pad"
                  error={phoneErr}
                />
              )}

              {selectedMethod === 'card' && (
                <Text style={styles.cardNote}>
                  You'll be redirected to a secure Paynow checkout page to complete your card payment.
                </Text>
              )}

              {selectedMethod === 'innbucks' && (
                <Text style={styles.cardNote}>
                  You'll receive an authorization code to enter in the InnBucks app.
                </Text>
              )}

              <View style={styles.upgradeBtn}>
                <Button
                  label={`Pay ${chargeDisplay} — Upgrade to Pro+`}
                  onPress={() => void handlePay()}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  scroll: { padding: 16, paddingBottom: 48 },

  // Plan comparison row
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 20 },
  planBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  planBadgePro: { backgroundColor: '#E6EEFF' },
  planBadgeProPlus: { backgroundColor: C.purpleLight, borderWidth: 1, borderColor: C.purpleBorder },
  planBadgeText: { fontSize: 15, fontWeight: '700', color: C.primary },
  planBadgeTextProPlus: { color: C.purple },

  // Proration card
  prorationCard: { marginBottom: 16 },
  prorationTitle: { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  prorationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  prorationLabel: { fontSize: 14, color: C.muted, flex: 1 },
  prorationValue: { fontSize: 14, color: C.text, fontWeight: '500' },
  prorationCredit: { color: C.success },
  prorationDivider: { height: 1, backgroundColor: C.border, marginVertical: 6 },
  prorationTotal: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  prorationTotalAmount: { color: C.purple, flex: 0 },
  prorationFreeNote: { fontSize: 12, color: C.success, marginTop: 4, fontStyle: 'italic' },
  prorationRenewal: { fontSize: 12, color: C.muted, marginTop: 6 },

  // Feature highlight
  featureBlock: { marginBottom: 20, paddingHorizontal: 4, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 14, color: C.purple, fontWeight: '500' },

  // Payment method
  sectionLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  methodCard: { flex: 1, minWidth: '40%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card },
  methodCardSelected: { borderColor: C.purple, backgroundColor: C.purpleLight },
  methodLabel: { fontSize: 14, color: C.muted, fontWeight: '500', flex: 1 },
  methodLabelSelected: { color: C.purple },
  methodDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple },

  cardNote: { fontSize: 13, color: C.muted, marginBottom: 12, lineHeight: 19 },

  // Upgrade button
  upgradeBtn: { marginTop: 4 },

  // Polling / loading states
  pollingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  pollingTitle: { fontSize: 18, fontWeight: '700', color: C.text, textAlign: 'center' },
  pollingHint: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
  pollingNote: { fontSize: 12, color: C.muted, marginTop: 8 },
  innbucksBox: { backgroundColor: C.purpleLight, borderRadius: 12, padding: 16, alignItems: 'center', gap: 8, width: '100%' },
  innbucksLabel: { fontSize: 13, color: C.muted },
  innbucksCode: { fontSize: 28, fontWeight: '800', color: C.purple, letterSpacing: 4 },
  openAppBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: C.purple, borderRadius: 8 },
  openAppText: { color: '#fff', fontWeight: '600' },

  // Success
  successContainer: { padding: 24, alignItems: 'center', gap: 12 },
  successIcon: { marginTop: 24, marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: '800', color: C.text },
  successBody: { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 22 },
  successCard: { width: '100%', backgroundColor: C.successLight, borderRadius: 12, padding: 16, gap: 4 },
  successCardLabel: { fontSize: 12, color: C.success, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 0.4 },
  successCardValue: { fontSize: 16, fontWeight: '700', color: C.text },

  // Failed
  failedTitle: { fontSize: 20, fontWeight: '700', color: C.danger },
  failedMsg: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },

  // WebView
  webViewHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  webViewBack: { padding: 8 },
  webViewTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginLeft: 8 },
})
