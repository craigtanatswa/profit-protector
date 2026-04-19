import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { Sale, SaleItem, Business, Customer } from '../../types'
import { formatCurrency, formatDateTime, formatPaymentMethod } from '../../lib/formatters'
import { Card } from '../ui/Card'

interface ReceiptCardProps {
  sale: Sale
  saleItems: SaleItem[]
  business: Business
  customer?: Customer
}

export function ReceiptCard({ sale, saleItems, business, customer }: ReceiptCardProps) {
  const subtotal = saleItems.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0)
  const currency = business.currency || 'USD'

  return (
    <Card padding="lg" style={styles.card}>
      {/* Business header */}
      <Text style={styles.businessName}>{business.name}</Text>
      <Text style={styles.businessPhone}>{business.phone}</Text>

      <View style={styles.dashedDivider} />

      {/* Receipt meta */}
      <Text style={styles.metaText}>{sale.receiptNumber}</Text>
      <Text style={styles.metaText}>{formatDateTime(sale.createdAt)}</Text>

      <View style={styles.dashedDivider} />

      {/* Items header */}
      <View style={styles.itemsHeaderRow}>
        <Text style={styles.itemsHeaderText}>ITEM</Text>
        <Text style={styles.itemsHeaderText}>QTY{'  '}PRICE{'  '}TOTAL</Text>
      </View>

      <View style={styles.dashedDivider} />

      {/* Items */}
      {saleItems.map((item, index) => (
        <View
          key={item.id}
          style={[styles.itemRow, index < saleItems.length - 1 && styles.itemBorder]}
        >
          <Text style={styles.itemName} numberOfLines={3}>
            {item.productNameSnapshot}
          </Text>
          <Text style={styles.itemQty}>{item.qty}</Text>
          <Text style={styles.itemPrice}>{formatCurrency(item.unitPriceCents, currency)}</Text>
          <Text style={styles.itemTotal}>
            {formatCurrency(item.unitPriceCents * item.qty, currency)}
          </Text>
        </View>
      ))}

      <View style={styles.dashedDivider} />

      {/* Subtotal */}
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Subtotal</Text>
        <Text style={styles.totalsValue}>{formatCurrency(subtotal, currency)}</Text>
      </View>

      {/* Discount */}
      {sale.discountCents > 0 && (
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Discount</Text>
          <Text style={styles.discountValue}>
            -{formatCurrency(sale.discountCents, currency)}
          </Text>
        </View>
      )}

      {/* Bold divider before total */}
      <View style={styles.boldDivider} />

      {/* Total */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>{formatCurrency(sale.totalCents, currency)}</Text>
      </View>

      {/* Payment method */}
      <View style={styles.paymentRow}>
        <Text style={styles.paymentLabel}>Paid via</Text>
        <Text style={styles.paymentValue}>{formatPaymentMethod(sale.paymentMethod)}</Text>
      </View>

      {/* Customer info (credit sales) */}
      {customer != null && (
        <>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Customer</Text>
            <Text style={styles.paymentValue}>{customer.name}</Text>
          </View>
          {customer.outstandingBalanceCents > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel} />
              <Text style={styles.balanceOwed}>
                Balance owed: {formatCurrency(customer.outstandingBalanceCents, currency)}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Footer */}
      <View style={styles.dashedDivider} />
      <Text style={styles.thankYou}>Thank you for your business!</Text>
      <Text style={styles.footerBusiness}>{business.name}</Text>
      <Text style={styles.poweredBy}>Powered by Profit Protector</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  businessName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
  },
  businessPhone: {
    fontSize: 13,
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
  metaText: {
    fontSize: 12,
    color: '#5A6A8A',
    textAlign: 'center',
  },
  itemsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemsHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5A6A8A',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  itemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F6FB',
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    color: '#0D1B3E',
  },
  itemQty: {
    width: 32,
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
  },
  itemPrice: {
    width: 72,
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'right',
  },
  itemTotal: {
    width: 72,
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
    textAlign: 'right',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  totalsLabel: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  totalsValue: {
    fontSize: 13,
    color: '#0D1B3E',
  },
  discountValue: {
    fontSize: 13,
    color: '#C0152A',
  },
  boldDivider: {
    height: 1,
    backgroundColor: 'rgba(13, 27, 62, 0.2)',
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
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
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  paymentLabel: {
    fontSize: 12,
    color: '#5A6A8A',
  },
  paymentValue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  balanceOwed: {
    fontSize: 12,
    fontWeight: '500',
    color: '#B45309',
  },
  thankYou: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 2,
  },
  footerBusiness: {
    fontSize: 12,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 4,
  },
  poweredBy: {
    fontSize: 10,
    color: '#DDE3F0',
    textAlign: 'center',
    marginTop: 8,
  },
})
