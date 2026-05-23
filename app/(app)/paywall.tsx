import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Modal,
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

import { Button, Card, Input } from '../../src/components/ui'
import { useAuthStore } from '../../src/stores/authStore'
import { useSubscription } from '../../src/hooks/useSubscription'
import {
  initiateCardPayment,
  initiateEcocashPayment,
  initiateInnbucksPayment,
  initiateOneMoneyPayment,
  pollPaymentStatus,
} from '../../src/lib/subscription'
import { formatDate } from '../../src/lib/formatters'
import type { InitiatePaymentResult } from '../../src/types'

// ── Theme tokens ────────────────────────────────────────────────────────────

const C = {
  primary: '#0047AB',
  primaryDark: '#003380',
  primaryLight: '#E6EEFF',
  background: '#F4F6FB',
  card: '#FFFFFF',
  border: '#DDE3F0',
  textPrimary: '#0D1B3E',
  textSecondary: '#5A6A8A',
  success: '#0A7A4B',
  successLight: '#EAF3DE',
  warning: '#B45309',
  danger: '#C0152A',
  dangerLight: '#FCEBEB',
}

type PaymentMethodKey = 'ecocash' | 'onemoney' | 'innbucks' | 'card'
type PaymentState = 'idle' | 'initiated' | 'polling' | 'success' | 'failed'

const METHOD_LABELS: Record<PaymentMethodKey, string> = {
  ecocash: 'EcoCash',
  onemoney: 'OneMoney',
  innbucks: 'InnBucks',
  card: 'Card',
}

function formatMethodLabel(method: PaymentMethodKey | null | string): string {
  if (method == null) return '—'
  if (method in METHOD_LABELS) return METHOD_LABELS[method as PaymentMethodKey]
  if (method === 'zimswitch') return 'Zimswitch'
  return String(method)
}

// ── Spinner (rotating sync icon) ────────────────────────────────────────────

function RotatingSpinner({ size = 32, color = C.primary }: { size?: number; color?: string }) {
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync" size={size} color={color} />
    </Animated.View>
  )
}

// ── Pulsing dots ────────────────────────────────────────────────────────────

function PulsingDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(450 - delay),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [delay, opacity])

  return (
    <Animated.View
      style={{
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: C.primary,
        opacity,
      }}
    />
  )
}

function PulsingDots() {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      <PulsingDot delay={0} />
      <PulsingDot delay={150} />
      <PulsingDot delay={300} />
    </View>
  )
}

// ── Success checkmark animation ─────────────────────────────────────────────

function SuccessBubble() {
  const scale = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 80,
      useNativeDriver: true,
    }).start()
  }, [scale])

  return (
    <Animated.View style={[styles.successBubble, { transform: [{ scale }] }]}>
      <Ionicons name="checkmark" size={40} color={C.success} />
    </Animated.View>
  )
}

// ── Method card ─────────────────────────────────────────────────────────────

interface MethodCardProps {
  methodKey: PaymentMethodKey
  label: string
  iconName: keyof typeof Ionicons.glyphMap
  iconColor: string
  note?: string
  selected: boolean
  onPress: () => void
}

function MethodCard({
  label,
  iconName,
  iconColor,
  note,
  selected,
  onPress,
}: MethodCardProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={[
        styles.methodCard,
        selected ? styles.methodCardSelected : styles.methodCardUnselected,
      ]}
    >
      <Ionicons
        name={iconName}
        size={28}
        color={selected ? iconColor : C.textSecondary}
      />
      <Text style={styles.methodLabel}>{label}</Text>
      <Text style={styles.methodPrice}>$10.00</Text>
      {note != null ? <Text style={styles.methodNote}>{note}</Text> : null}
    </TouchableOpacity>
  )
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const business = useAuthStore((s) => s.business)
  const user = useAuthStore((s) => s.user)
  const { refetch, nextBillingDate } = useSubscription()

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodKey | null>(null)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [paymentState, setPaymentState] = useState<PaymentState>('idle')
  const [pollUrl, setPollUrl] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [innbucksCode, setInnbucksCode] = useState('')
  const [innbucksDeepLink, setInnbucksDeepLink] = useState('')
  const [innbucksExpires, setInnbucksExpires] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [showWebView, setShowWebView] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  const scrollContentRef = useRef<View>(null)
  const phoneSectionRef = useRef<View>(null)

  const scrollPhoneFieldIntoView = useCallback(() => {
    const content = scrollContentRef.current
    const phoneSection = phoneSectionRef.current
    if (!content || !phoneSection) return
    phoneSection.measureLayout(
      content,
      (_x, y) => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, y - 24),
          animated: true,
        })
      },
      () => {},
    )
  }, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Polling loop
  useEffect(() => {
    if (paymentState !== 'initiated' && paymentState !== 'polling') return
    if (!pollUrl || !paymentId) return

    const interval = setInterval(async () => {
      try {
        const result = await pollPaymentStatus(paymentId, pollUrl)
        if (result.isPaid) {
          clearInterval(interval)
          pollingRef.current = null
          setPaymentState('success')
          await refetch()
        } else if (
          result.status?.toLowerCase() === 'cancelled' ||
          result.status?.toLowerCase() === 'failed'
        ) {
          clearInterval(interval)
          pollingRef.current = null
          setPaymentState('failed')
        }
      } catch (e) {
        console.warn('Poll error:', e)
      }
    }, 5000)

    pollingRef.current = interval
    return () => clearInterval(interval)
  }, [paymentState, pollUrl, paymentId, refetch])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const resetForm = useCallback(() => {
    stopPolling()
    setPaymentState('idle')
    setPollUrl('')
    setPaymentId('')
    setInstructions('')
    setInnbucksCode('')
    setInnbucksDeepLink('')
    setInnbucksExpires('')
    setRedirectUrl('')
    setShowWebView(false)
  }, [stopPolling])

  // ── Pay handler ──────────────────────────────────────────────────────────

  async function handlePay() {
    if (!business?.id || !selectedMethod) return

    setIsLoading(true)
    try {
      const authEmail =
        user?.email ?? business.recoveryEmail ?? `${business.phone}@profitprotector.app`

      let result: InitiatePaymentResult

      if (selectedMethod === 'ecocash') {
        result = await initiateEcocashPayment({
          businessId: business.id,
          phoneNumber,
          authEmail,
        })
      } else if (selectedMethod === 'onemoney') {
        result = await initiateOneMoneyPayment({
          businessId: business.id,
          phoneNumber,
          authEmail,
        })
      } else if (selectedMethod === 'innbucks') {
        result = await initiateInnbucksPayment({
          businessId: business.id,
          authEmail,
        })
      } else if (selectedMethod === 'card') {
        result = await initiateCardPayment({
          businessId: business.id,
          authEmail,
        })
      } else {
        return
      }

      if (!result.success) {
        Alert.alert(
          'Payment Failed',
          result.message ?? 'Could not initiate payment. Please try again.',
        )
        return
      }

      setPollUrl(result.pollUrl ?? '')
      setPaymentId(result.paymentId ?? '')

      if (selectedMethod === 'card') {
        setRedirectUrl(result.redirectUrl ?? '')
        setShowWebView(true)
      } else if (selectedMethod === 'innbucks') {
        setInnbucksCode(result.authorizationCode ?? '')
        setInnbucksDeepLink(result.deepLink ?? '')
        setInnbucksExpires(result.authorizationExpires ?? '')
        setPaymentState('initiated')
      } else {
        setInstructions(result.instructions ?? '')
        setPaymentState('initiated')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong'
      Alert.alert('Error', msg)
    } finally {
      setIsLoading(false)
    }
  }

  // ── WebView card flow ────────────────────────────────────────────────────

  async function handleWebViewReturn() {
    setShowWebView(false)
    if (!paymentId || !pollUrl) {
      setPaymentState('idle')
      return
    }
    try {
      const result = await pollPaymentStatus(paymentId, pollUrl)
      if (result.isPaid) {
        setPaymentState('success')
        await refetch()
      } else {
        setPaymentState('idle')
      }
    } catch {
      setPaymentState('idle')
    }
  }

  // ── Button computed state ────────────────────────────────────────────────

  let payButtonLabel = 'Select a payment method'
  let payButtonDisabled = true

  if (selectedMethod != null) {
    if (
      (selectedMethod === 'ecocash' || selectedMethod === 'onemoney') &&
      phoneNumber.trim().length === 0
    ) {
      payButtonLabel = 'Enter your mobile number'
      payButtonDisabled = true
    } else {
      payButtonLabel = `Pay $10.00 via ${METHOD_LABELS[selectedMethod]}`
      payButtonDisabled = false
    }
  }

  // ── Card WebView fullscreen ──────────────────────────────────────────────

  if (showWebView) {
    return (
      <Modal visible animationType="slide" onRequestClose={handleWebViewReturn}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.primary }} edges={['top']}>
          <View style={styles.webHeader}>
            <Text style={styles.webHeaderTitle}>Secure Payment</Text>
            <TouchableOpacity
              onPress={() => {
                setShowWebView(false)
                setPaymentState('idle')
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.webHeaderClose}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <WebView
            source={{ uri: redirectUrl }}
            onNavigationStateChange={(navState) => {
              if (navState.url.includes('paynow-card-complete')) {
                void handleWebViewReturn()
              }
            }}
            style={{ flex: 1, backgroundColor: '#FFFFFF' }}
          />
        </SafeAreaView>
      </Modal>
    )
  }

  // ── Success view ─────────────────────────────────────────────────────────

  if (paymentState === 'success') {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.successContainer}>
          <SuccessBubble />
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={styles.successSubtitle}>
            Your Profit Protector subscription is now active.
          </Text>

          <Card style={styles.receiptCard} padding="md">
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Amount paid</Text>
              <Text style={styles.kvValue}>$10.00</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Next renewal</Text>
              <Text style={styles.kvValue}>
                {nextBillingDate != null && !Number.isNaN(nextBillingDate.getTime())
                  ? formatDate(nextBillingDate.getTime())
                  : '—'}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Payment via</Text>
              <Text style={styles.kvValue}>{formatMethodLabel(selectedMethod)}</Text>
            </View>
          </Card>

          <View style={{ marginTop: 24, width: '100%' }}>
            <Button
              label="Continue to your business"
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => router.replace('/(app)')}
            />
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── Failed view ──────────────────────────────────────────────────────────

  if (paymentState === 'failed') {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.successContainer}>
          <Ionicons name="close-circle" size={64} color={C.danger} />
          <Text style={[styles.successTitle, { marginTop: 16 }]}>
            Payment not completed
          </Text>
          <Text style={styles.successSubtitle}>
            The payment was cancelled or failed. Please check your balance and
            try again.
          </Text>

          <View style={{ marginTop: 24, width: '100%' }}>
            <Button
              label="Try Again"
              variant="primary"
              size="lg"
              fullWidth
              onPress={resetForm}
            />
          </View>
        </SafeAreaView>
      </View>
    )
  }

  // ── Main paywall ─────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Ionicons
          name="shield-checkmark"
          size={40}
          color="rgba(255,255,255,0.9)"
        />
        <Text style={styles.headerTitle}>Profit Protector</Text>
        <Text style={styles.headerSubtitle}>Keep your business protected</Text>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <View ref={scrollContentRef} collapsable={false}>
        {/* Trial expired card */}
        <View style={{ margin: 16 }}>
          <Card padding="md">
            <View style={styles.expiredBanner}>
              <Ionicons name="time" size={18} color={C.danger} />
              <Text style={styles.expiredBannerText}>
                Your free trial has ended
              </Text>
            </View>

            <Text style={styles.expiredBody}>
              To keep accessing Profit Protector and all your business data,
              subscribe for just $10 per month.
            </Text>

            {[
              'All your sales history',
              'All products and stock records',
              'All customer records and debts',
              'All reports and receipts',
            ].map((label) => (
              <View key={label} style={styles.checklistRow}>
                <Ionicons name="checkmark-circle" size={16} color={C.success} />
                <Text style={styles.checklistText}>{label}</Text>
              </View>
            ))}
          </Card>
        </View>

        {/* Payment state UI replaces method selection when paying */}
        {paymentState === 'idle' ? (
          <>
            <Text style={styles.sectionLabel}>Choose how to pay</Text>

            <View style={styles.methodGrid}>
              <View style={styles.methodRow}>
                <MethodCard
                  methodKey="ecocash"
                  label="EcoCash"
                  iconName="phone-portrait"
                  iconColor={C.success}
                  selected={selectedMethod === 'ecocash'}
                  onPress={() => setSelectedMethod('ecocash')}
                />
                <MethodCard
                  methodKey="onemoney"
                  label="OneMoney"
                  iconName="phone-portrait"
                  iconColor={C.primaryDark}
                  selected={selectedMethod === 'onemoney'}
                  onPress={() => setSelectedMethod('onemoney')}
                />
              </View>
              <View style={styles.methodRow}>
                <MethodCard
                  methodKey="innbucks"
                  label="InnBucks"
                  iconName="wallet"
                  iconColor={C.warning}
                  selected={selectedMethod === 'innbucks'}
                  onPress={() => setSelectedMethod('innbucks')}
                />
                <MethodCard
                  methodKey="card"
                  label="Card"
                  iconName="card"
                  iconColor={C.primary}
                  selected={selectedMethod === 'card'}
                  onPress={() => setSelectedMethod('card')}
                  note="zimswitch"
                />
              </View>
            </View>

            {/* Form per method */}
            {(selectedMethod === 'ecocash' || selectedMethod === 'onemoney') && (
              <View
                ref={phoneSectionRef}
                collapsable={false}
                style={{ marginHorizontal: 16, marginTop: 12 }}
              >
                <Card padding="md">
                  <Input
                    label="Mobile Number"
                    keyboardType="phone-pad"
                    placeholder="e.g. 0771234567"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    onFocus={scrollPhoneFieldIntoView}
                    hint={
                      selectedMethod === 'ecocash'
                        ? 'Your EcoCash number'
                        : 'Your OneMoney number'
                    }
                    leftIcon={
                      <Ionicons
                        name="phone-portrait-outline"
                        size={18}
                        color={C.textSecondary}
                      />
                    }
                  />
                </Card>
              </View>
            )}

            {selectedMethod === 'innbucks' && (
              <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                <Card padding="md">
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="information-circle"
                      size={16}
                      color={C.primary}
                    />
                    <Text style={styles.infoRowText}>
                      You will receive an authorization code to complete payment
                      in your InnBucks app.
                    </Text>
                  </View>
                </Card>
              </View>
            )}

            {selectedMethod === 'card' && (
              <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                <Card padding="md">
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="information-circle"
                      size={16}
                      color={C.primary}
                    />
                    <Text style={styles.infoRowText}>
                      You will be redirected to Paynow to pay with your
                      Zimswitch-enabled bank card.
                    </Text>
                  </View>
                </Card>
              </View>
            )}

            <View style={{ margin: 16 }}>
              <Button
                label={payButtonLabel}
                variant="primary"
                size="lg"
                fullWidth
                loading={isLoading}
                disabled={payButtonDisabled}
                onPress={handlePay}
              />
            </View>
          </>
        ) : null}

        {/* Initiated state */}
        {(paymentState === 'initiated' || paymentState === 'polling') &&
          (selectedMethod === 'ecocash' || selectedMethod === 'onemoney') && (
            <View style={{ margin: 16 }}>
              <View style={styles.pollingCard}>
                <View style={{ alignItems: 'center', marginBottom: 12 }}>
                  <RotatingSpinner size={32} color={C.primary} />
                </View>
                <Text style={styles.pollingTitle}>Payment request sent!</Text>
                {instructions ? (
                  <Text style={styles.pollingInstructions}>{instructions}</Text>
                ) : (
                  <Text style={styles.pollingInstructions}>
                    Check your phone and approve the payment to continue.
                  </Text>
                )}

                <View style={styles.pollingStatusRow}>
                  <PulsingDots />
                  <Text style={styles.pollingStatusText}>
                    Checking payment status...
                  </Text>
                </View>

                <View style={{ marginTop: 16 }}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="md"
                    fullWidth
                    onPress={resetForm}
                  />
                </View>
              </View>
            </View>
          )}

        {(paymentState === 'initiated' || paymentState === 'polling') &&
          selectedMethod === 'innbucks' && (
            <View style={{ margin: 16 }}>
              <Card padding="md">
                <Text style={styles.innLabel}>Authorization Code</Text>
                <Text style={styles.innCode}>{innbucksCode || '— — — —'}</Text>
                <Text style={styles.innExpires}>
                  Expires: {innbucksExpires || '—'}
                </Text>

                <View style={{ marginTop: 14 }}>
                  <Button
                    label="Open InnBucks App"
                    variant="primary"
                    size="md"
                    fullWidth
                    onPress={() => {
                      if (innbucksDeepLink) {
                        void Linking.openURL(innbucksDeepLink)
                      }
                    }}
                  />
                </View>
                <View style={{ marginTop: 8 }}>
                  <Button
                    label="Check Payment Status"
                    variant="secondary"
                    size="md"
                    fullWidth
                    onPress={async () => {
                      try {
                        const result = await pollPaymentStatus(paymentId, pollUrl)
                        if (result.isPaid) {
                          setPaymentState('success')
                          await refetch()
                        } else if (
                          result.status?.toLowerCase() === 'cancelled' ||
                          result.status?.toLowerCase() === 'failed'
                        ) {
                          setPaymentState('failed')
                        } else {
                          Alert.alert(
                            'Payment Pending',
                            'We have not received the payment yet. Please try again in a moment.',
                          )
                        }
                      } catch (e) {
                        const msg =
                          e instanceof Error ? e.message : 'Could not check status'
                        Alert.alert('Error', msg)
                      }
                    }}
                  />
                </View>

                <View style={{ marginTop: 8 }}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="md"
                    fullWidth
                    onPress={resetForm}
                  />
                </View>
              </Card>
            </View>
          )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: C.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  expiredBannerText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.danger,
  },
  expiredBody: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 16,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  checklistText: {
    fontSize: 13,
    color: C.textPrimary,
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: C.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  methodGrid: {
    paddingHorizontal: 16,
    gap: 10,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  methodCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  methodCardSelected: {
    borderWidth: 2,
    borderColor: C.primary,
    backgroundColor: C.primaryLight,
  },
  methodCardUnselected: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  methodLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textPrimary,
    marginTop: 6,
    textAlign: 'center',
  },
  methodPrice: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  methodNote: {
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.primaryLight,
    borderRadius: 8,
    padding: 12,
  },
  infoRowText: {
    flex: 1,
    fontSize: 13,
    color: C.primary,
    lineHeight: 18,
  },
  pollingCard: {
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: 12,
    padding: 16,
  },
  pollingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
    textAlign: 'center',
  },
  pollingInstructions: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  pollingStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  pollingStatusText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  innLabel: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '500',
    marginBottom: 6,
    textAlign: 'center',
  },
  innCode: {
    fontSize: 32,
    fontWeight: '700',
    color: C.primary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    textAlign: 'center',
    backgroundColor: C.primaryLight,
    paddingVertical: 12,
    borderRadius: 8,
    letterSpacing: 2,
  },
  innExpires: {
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.successLight,
    borderWidth: 2,
    borderColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
    marginTop: 20,
  },
  successSubtitle: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 25,
    marginTop: 8,
  },
  receiptCard: {
    marginTop: 24,
    width: '100%',
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  kvKey: {
    fontSize: 13,
    color: C.textSecondary,
  },
  kvValue: {
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: '500',
  },
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  webHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  webHeaderClose: {
    position: 'absolute',
    right: 12,
    top: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
