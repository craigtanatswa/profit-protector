import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Badge, Card, EmptyState } from '../../../src/components/ui'
import { ScreenHeader } from '../../../src/components/layout'
import { useAuthStore } from '../../../src/stores/authStore'
import { fetchPaymentHistory } from '../../../src/lib/subscription'
import { formatDateTime } from '../../../src/lib/formatters'
import type { Payment } from '../../../src/types'

const C = {
  background: '#F4F6FB',
  card: '#FFFFFF',
  border: '#DDE3F0',
  textPrimary: '#0D1B3E',
  textSecondary: '#5A6A8A',
}

type StatusVariant = 'success' | 'warning' | 'danger' | 'neutral'

interface StatusMeta {
  label: string
  variant: StatusVariant
}

function statusMeta(status: Payment['status']): StatusMeta {
  switch (status) {
    case 'paid':
      return { label: 'Paid', variant: 'success' }
    case 'pending':
      return { label: 'Pending', variant: 'warning' }
    case 'failed':
      return { label: 'Failed', variant: 'danger' }
    case 'cancelled':
      return { label: 'Cancelled', variant: 'neutral' }
    default:
      return { label: String(status), variant: 'neutral' }
  }
}

function methodIcon(method: string): keyof typeof import('@expo/vector-icons').Ionicons.glyphMap {
  if (method === 'card') return 'card'
  if (method === 'innbucks') return 'wallet'
  return 'phone-portrait'
}

function methodLabel(method: string): string {
  switch (method) {
    case 'ecocash':
      return 'EcoCash'
    case 'onemoney':
      return 'OneMoney'
    case 'innbucks':
      return 'InnBucks'
    case 'card':
      return 'Visa / Mastercard'
    default:
      return method
  }
}

function formatAmount(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2)
  if (currency === 'USD') return `$${amount}`
  return `${currency} ${amount}`
}

export default function PaymentHistoryScreen() {
  const business = useAuthStore((s) => s.business)
  const [payments, setPayments] = useState<Payment[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    if (!business?.id) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const data = await fetchPaymentHistory(business.id)
      setPayments(data)
    } catch (e) {
      console.warn('fetchPaymentHistory failed', e)
    } finally {
      setIsLoading(false)
    }
  }, [business?.id])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScreenHeader
        title="Payment History"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0047AB" />
        </View>
      ) : payments.length === 0 ? (
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <EmptyState
            icon="receipt-outline"
            title="No payments yet"
            subtitle="Your payment history will appear here"
          />
        </SafeAreaView>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {payments.map((payment) => {
            const meta = statusMeta(payment.status)
            const createdMs = Date.parse(payment.createdAt)
            return (
              <Card key={payment.id} padding="md" style={styles.card}>
                <View style={styles.topRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.title}>Profit Protector Pro</Text>
                    <Text style={styles.subtitle}>
                      {Number.isFinite(createdMs) ? formatDateTime(createdMs) : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={styles.amount}>
                      {formatAmount(payment.amountCents, payment.currency)}
                    </Text>
                    <Badge label={meta.label} variant={meta.variant} size="sm" />
                  </View>
                </View>

                <View style={styles.methodRow}>
                  <Ionicons
                    name={methodIcon(payment.paymentMethod)}
                    size={14}
                    color={C.textSecondary}
                  />
                  <Text style={styles.methodText}>
                    {methodLabel(payment.paymentMethod)}
                    {payment.phoneNumber ? ` · ${payment.phoneNumber}` : ''}
                  </Text>
                </View>
              </Card>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
  },
  card: {
    marginBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  methodText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
