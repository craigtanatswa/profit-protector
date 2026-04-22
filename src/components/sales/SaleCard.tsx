import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '../ui/Card'
import { useMoneyFormat } from '../../hooks/useMoneyFormat'
import type { Sale, SaleItem, PaymentMethod } from '../../types'

interface SaleCardProps {
  sale: Sale
  saleItems: SaleItem[]
  onPress: () => void
}

interface PaymentBadgeStyle {
  background: string
  text: string
  label: string
}

const PAYMENT_BADGE: Record<PaymentMethod, PaymentBadgeStyle> = {
  cash_usd:      { background: '#E6EEFF', text: '#0047AB', label: 'Cash $' },
  cash_zig:      { background: '#E6EEFF', text: '#0047AB', label: 'Cash ZiG' },
  ecocash:       { background: '#EAF3DE', text: '#3B6D11', label: 'EcoCash' },
  bank_transfer: { background: '#FAEEDA', text: '#854F0B', label: 'Bank' },
  credit:        { background: '#FCEBEB', text: '#A32D2D', label: 'Credit' },
}

const BORDER_COLOR: Record<PaymentMethod, string> = {
  cash_usd:      '#0047AB',
  cash_zig:      '#0047AB',
  ecocash:       '#3B6D11',
  bank_transfer: '#B45309',
  credit:        '#C0152A',
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function SaleCard({ sale, saleItems, onPress }: SaleCardProps) {
  const { formatMoney } = useMoneyFormat()
  const badge = PAYMENT_BADGE[sale.paymentMethod] ?? PAYMENT_BADGE.cash_usd
  const borderColor = BORDER_COLOR[sale.paymentMethod] ?? '#0047AB'

  const profitCents = saleItems.reduce(
    (sum, item) => sum + (item.unitPriceCents - item.costPriceCents) * item.qty,
    0,
  )

  const itemCount = saleItems.reduce((sum, item) => sum + item.qty, 0)

  const profitColor =
    profitCents > 0 ? '#0A7A4B' : profitCents < 0 ? '#C0152A' : '#5A6A8A'

  return (
    <Card
      onPress={onPress}
      padding="md"
      style={[styles.card, { borderLeftWidth: 3, borderLeftColor: borderColor }]}
    >
      {/* Row 1 */}
      <View style={styles.row}>
        <View style={styles.leftCol}>
          <Text style={styles.receiptNumber}>{sale.receiptNumber}</Text>
          <Text style={styles.time}>{formatTime(sale.createdAt)}</Text>
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.total}>{formatMoney(sale.totalCents)}</Text>
          <View
            style={[
              styles.paymentBadge,
              { backgroundColor: badge.background },
            ]}
          >
            <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
              {badge.label}
            </Text>
          </View>
        </View>
      </View>

      {/* Row 2 */}
      <View style={[styles.row, styles.row2]}>
        <View style={styles.itemCountRow}>
          <Ionicons name="cube-outline" size={13} color="#5A6A8A" />
          <Text style={styles.itemCountText}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <View style={styles.profitRow}>
          <Text style={[styles.profit, { color: profitColor }]}>
            {formatMoney(profitCents)}
          </Text>
          <Text style={styles.profitLabel}>profit</Text>
        </View>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row2: {
    marginTop: 8,
  },
  leftCol: {
    flex: 1,
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  receiptNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  time: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  total: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0047AB',
  },
  paymentBadge: {
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  paymentBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  itemCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemCountText: {
    fontSize: 13,
    color: '#5A6A8A',
    marginLeft: 4,
  },
  profitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profit: {
    fontSize: 13,
    fontWeight: '500',
  },
  profitLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    marginLeft: 4,
  },
})
