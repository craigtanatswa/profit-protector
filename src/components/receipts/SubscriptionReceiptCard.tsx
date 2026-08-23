import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import type { Business, Payment } from '../../types'
import { formatDateTime, formatPaymentMethod } from '../../lib/formatters'
import {
  formatPaymentAmount,
  paymentDescription,
  paymentReceiptNumber,
  paymentStatusLabel,
} from '../../lib/subscriptionReceipt'
import { Card } from '../ui/Card'

const officialLogo = require('../../../assets/logo-mark-blue.png')

interface SubscriptionReceiptCardProps {
  payment: Payment
  business: Business
}

export function SubscriptionReceiptCard({ payment, business }: SubscriptionReceiptCardProps) {
  const createdMs = Date.parse(payment.createdAt)
  const dateLabel = Number.isFinite(createdMs) ? formatDateTime(createdMs) : payment.createdAt
  const status = paymentStatusLabel(payment.status)
  const paidVia = payment.phoneNumber
    ? `${formatPaymentMethod(payment.paymentMethod)} · ${payment.phoneNumber}`
    : formatPaymentMethod(payment.paymentMethod)

  return (
    <Card padding="lg" style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.logoWrap}>
          <Image source={officialLogo} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.brand}>PROFIT PROTECTOR</Text>
          <Text style={styles.title}>Payment Receipt</Text>
          <Text style={styles.meta}>{paymentReceiptNumber(payment)}</Text>
          <Text style={styles.meta}>{dateLabel}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.dashedDivider} />

      <View style={styles.row}>
        <Text style={styles.label}>Billed to</Text>
        <Text style={styles.value}>{business.name || '—'}</Text>
      </View>
      {business.ownerName ? (
        <View style={styles.row}>
          <Text style={styles.label}>Owner</Text>
          <Text style={styles.value}>{business.ownerName}</Text>
        </View>
      ) : null}
      {business.phone ? (
        <View style={styles.row}>
          <Text style={styles.label}>Phone</Text>
          <Text style={styles.value}>{business.phone}</Text>
        </View>
      ) : null}

      <View style={styles.dashedDivider} />

      <View style={styles.row}>
        <Text style={styles.label}>Description</Text>
        <Text style={[styles.value, styles.wrap]}>{paymentDescription(payment)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Paid via</Text>
        <Text style={[styles.value, styles.wrap]}>{paidVia}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.value}>{status}</Text>
      </View>
      {payment.paynowStatus ? (
        <View style={styles.row}>
          <Text style={styles.label}>Paynow status</Text>
          <Text style={styles.value}>{payment.paynowStatus}</Text>
        </View>
      ) : null}

      <View style={styles.boldDivider} />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>AMOUNT</Text>
        <Text style={styles.totalValue}>
          {formatPaymentAmount(payment.amountCents, payment.currency)}
        </Text>
      </View>

      <View style={styles.dashedDivider} />
      <Text style={styles.footer}>Thank you for subscribing to Profit Protector.</Text>
      <Text style={styles.poweredBy}>This receipt confirms your in-app subscription payment.</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  logo: {
    width: 56,
    height: 56,
  },
  headerCenter: {
    flex: 1,
  },
  headerSpacer: {
    width: 56,
  },
  brand: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#0047AB',
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginTop: 4,
  },
  meta: {
    fontSize: 12,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 2,
  },
  dashedDivider: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#DDE3F0',
    marginVertical: 10,
  },
  boldDivider: {
    height: 1,
    backgroundColor: 'rgba(13, 27, 62, 0.2)',
    marginVertical: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginVertical: 3,
  },
  label: {
    fontSize: 13,
    color: '#5A6A8A',
    flexShrink: 0,
  },
  value: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0D1B3E',
    textAlign: 'right',
    flex: 1,
  },
  wrap: {
    flexShrink: 1,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0047AB',
  },
  footer: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#5A6A8A',
    textAlign: 'center',
  },
  poweredBy: {
    fontSize: 10,
    color: '#A8B4C8',
    textAlign: 'center',
    marginTop: 6,
  },
})
