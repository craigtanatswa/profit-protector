import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import type { Sale, SaleItem, Business, Customer } from '../../types'
import { formatCurrency, formatDateTime, formatPaymentMethod } from '../../lib/formatters'
import { formatQty, lineTotalCents } from '../../lib/quantity'
import { Card } from '../ui/Card'

interface ReceiptCardProps {
  sale: Sale
  saleItems: SaleItem[]
  business: Business
  customer?: Customer
  /** Initial deposit collected on a partial credit sale. */
  creditPaidCents?: number
  creditDepositMethod?: string
  /** Local file URI of optional business logo (same as PDF/print). */
  headerLogoUri?: string | null
}

export function ReceiptCard({
  sale,
  saleItems,
  business,
  customer,
  creditPaidCents = 0,
  creditDepositMethod,
  headerLogoUri,
}: ReceiptCardProps) {
  const subtotal = saleItems.reduce((sum, item) => sum + lineTotalCents(item.qty, item.unitPriceCents), 0)
  const currency = business.currency || 'USD'
  const zigRate = business.zigRatePerUsd ?? 1

  return (
    <Card padding="lg" style={styles.card}>
      {/* Business header */}
      {headerLogoUri != null && headerLogoUri.length > 0 ? (
        <View style={styles.logoWrap}>
          <Image source={{ uri: headerLogoUri }} style={styles.logoImg} resizeMode="contain" />
        </View>
      ) : null}
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
          <Text style={styles.itemQty}>{formatQty(item.qty)}</Text>
          <Text style={styles.itemPrice}>{formatCurrency(item.unitPriceCents, currency, zigRate)}</Text>
          <Text style={styles.itemTotal}>
            {formatCurrency(lineTotalCents(item.qty, item.unitPriceCents), currency, zigRate)}
          </Text>
        </View>
      ))}

      <View style={styles.dashedDivider} />

      {/* Subtotal */}
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Subtotal</Text>
        <Text style={styles.totalsValue}>{formatCurrency(subtotal, currency, zigRate)}</Text>
      </View>

      {/* Discount */}
      {sale.discountCents > 0 && (
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Discount</Text>
          <Text style={styles.discountValue}>
            -{formatCurrency(sale.discountCents, currency, zigRate)}
          </Text>
        </View>
      )}

      {/* Bold divider before total */}
      <View style={styles.boldDivider} />

      {/* Total */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>{formatCurrency(sale.totalCents, currency, zigRate)}</Text>
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
          {creditPaidCents > 0 && creditPaidCents < sale.totalCents && (
            <>
              <View style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>Paid now</Text>
                <Text style={styles.paymentValue}>
                  {formatCurrency(creditPaidCents, currency, zigRate)}
                  {creditDepositMethod
                    ? ` via ${formatPaymentMethod(creditDepositMethod)}`
                    : ''}
                </Text>
              </View>
              <View style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>On credit</Text>
                <Text style={styles.balanceOwed}>
                  {formatCurrency(sale.totalCents - creditPaidCents, currency, zigRate)}
                </Text>
              </View>
            </>
          )}
          {customer.outstandingBalanceCents > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel} />
              <Text style={styles.balanceOwed}>
                Balance owed: {formatCurrency(customer.outstandingBalanceCents, currency, zigRate)}
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
  logoWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  logoImg: {
    height: 48,
    width: '100%',
    maxWidth: 200,
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
