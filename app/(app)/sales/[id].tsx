import React, { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { Q } from '@nozbe/watermelondb'
import { Ionicons } from '@expo/vector-icons'

import { database } from '../../../src/database'
import { useAuthStore } from '../../../src/stores/authStore'
import { ScreenHeader } from '../../../src/components/layout'
import { Button, EmptyState, LoadingScreen } from '../../../src/components/ui'
import { ReceiptCard } from '../../../src/components/receipts/ReceiptCard'
import { getBusinessLogoDisplayUri } from '../../../src/lib/businessLogo'
import { shareReceipt, printReceiptBluetooth } from '../../../src/lib/receipt'
import { formatCurrency } from '../../../src/lib/formatters'
import { mapSaleRecord, mapSaleItemRecord } from '../../../src/hooks/useSales'
import type { Sale, SaleItem, Business, Customer } from '../../../src/types'
import type SaleModel from '../../../src/database/models/Sale'
import type SaleItemModel from '../../../src/database/models/SaleItem'
import type CustomerModel from '../../../src/database/models/Customer'
import type CreditSaleModel from '../../../src/database/models/CreditSale'

export default function SaleDetailScreen() {
  const router = useRouter()
  const { id, showReceipt } = useLocalSearchParams<{ id: string; showReceipt?: string }>()
  const isPostSale = showReceipt === 'true'
  const authBusiness = useAuthStore((state) => state.business)

  const [sale, setSale] = useState<Sale | null>(null)
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [headerLogoUri, setHeaderLogoUri] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      setHeaderLogoUri(getBusinessLogoDisplayUri())
    }, []),
  )

  const load = useCallback(async () => {
    if (!database || !id) {
      setNotFound(true)
      setIsLoading(false)
      return
    }

    try {
      const saleRecord = await database!.get<SaleModel>('sales').find(id)
      setSale(mapSaleRecord(saleRecord))

      const itemRecords = await database!
        .get<SaleItemModel>('sale_items')
        .query(Q.where('sale_id', id))
        .fetch()
      setSaleItems(itemRecords.map(mapSaleItemRecord))

      if (saleRecord.paymentMethod === 'credit') {
        const creditRecords = await database!
          .get<CreditSaleModel>('credit_sales')
          .query(Q.where('sale_id', id))
          .fetch()

        if (creditRecords.length > 0) {
          const customerRecord = await database!
            .get<CustomerModel>('customers')
            .find(creditRecords[0].customerId)

          setCustomer({
            id: customerRecord.id,
            businessId: customerRecord.businessId,
            name: customerRecord.name,
            phone: customerRecord.phone ?? undefined,
            outstandingBalanceCents: customerRecord.outstandingBalanceCents,
            createdAt:
              customerRecord.createdAt instanceof Date
                ? customerRecord.createdAt.getTime()
                : Date.now(),
          })
        }
      }
    } catch {
      setNotFound(true)
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    setIsLoading(true)
    void load()
  }, [load])

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const businessForReceipt: Business = {
    id: authBusiness?.id ?? '',
    name: authBusiness?.name ?? '',
    ownerName: authBusiness?.ownerName ?? '',
    phone: authBusiness?.phone ?? '',
    businessType: authBusiness?.businessType ?? '',
    currency: authBusiness?.currency ?? 'USD',
    zigRatePerUsd: authBusiness?.zigRatePerUsd ?? 1,
    createdAt: 0,
  }

  const handleShare = async () => {
    if (!sale) return
    setIsSharing(true)
    try {
      await shareReceipt({
        sale,
        saleItems,
        business: businessForReceipt,
        customer: customer ?? undefined,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      Alert.alert('Error', message)
    } finally {
      setIsSharing(false)
    }
  }

  const handlePrint = async () => {
    if (!sale) return
    setIsPrinting(true)
    try {
      await printReceiptBluetooth({
        sale,
        saleItems,
        business: businessForReceipt,
        customer: customer ?? undefined,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      Alert.alert('Error', message)
    } finally {
      setIsPrinting(false)
    }
  }

  if (isLoading) {
    return <LoadingScreen message="Loading receipt..." />
  }

  if (notFound || !sale) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Sale Details"
          leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
          showBorder
        />
        <EmptyState
          icon="receipt-outline"
          title="Sale not found"
          subtitle="This sale may have been deleted"
        />
      </SafeAreaView>
    )
  }

  const currency = businessForReceipt.currency
  const zigRate = businessForReceipt.zigRatePerUsd ?? 1
  const itemsSold = saleItems.length
  const unitsSold = saleItems.reduce((sum, item) => sum + item.qty, 0)
  const profit = saleItems.reduce(
    (sum, item) => sum + (item.unitPriceCents - item.costPriceCents) * item.qty,
    0,
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={isPostSale ? 'Sale Complete' : 'Sale Details'}
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'share-outline', onPress: handleShare }}
        showBorder
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success banner — only post-sale */}
        {isPostSale && (
          <>
            <View style={styles.successBanner}>
              <View style={styles.successRow}>
                <Ionicons name="checkmark-circle" size={24} color="#0047AB" />
                <Text style={styles.successText}>Sale recorded successfully!</Text>
              </View>
              <Text style={styles.receiptNumberMeta}>{sale.receiptNumber}</Text>
            </View>

            {/* Quick metrics */}
            <View style={styles.metricsRow}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Items sold</Text>
                <Text style={styles.metricValue}>{itemsSold}</Text>
              </View>
              <View style={[styles.metricItem, styles.metricBorder]}>
                <Text style={styles.metricLabel}>Units sold</Text>
                <Text style={styles.metricValue}>{unitsSold}</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Profit</Text>
                <Text
                  style={[
                    styles.metricValue,
                    { color: profit >= 0 ? '#0A7A4B' : '#C0152A' },
                  ]}
                >
                  {formatCurrency(profit, currency, zigRate)}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Receipt card */}
        <ReceiptCard
          sale={sale}
          saleItems={saleItems}
          business={businessForReceipt}
          customer={customer ?? undefined}
          headerLogoUri={headerLogoUri}
        />

        {/* Share + Print buttons */}
        <View style={styles.actionRow}>
          <View style={styles.actionButton}>
            <Button
              label={isSharing ? 'Sharing…' : 'Share'}
              onPress={handleShare}
              variant="secondary"
              loading={isSharing}
              icon={
                isSharing ? undefined : (
                  <Ionicons name="share-social-outline" size={18} color="#0047AB" />
                )
              }
              fullWidth
            />
          </View>
          <View style={styles.actionButton}>
            <Button
              label={isPrinting ? 'Opening…' : 'Print'}
              onPress={handlePrint}
              variant="secondary"
              loading={isPrinting}
              icon={
                isPrinting ? undefined : (
                  <Ionicons name="print-outline" size={18} color="#0047AB" />
                )
              }
              fullWidth
            />
          </View>
        </View>

        {/* New Sale + Back to Dashboard — only post-sale */}
        {isPostSale && (
          <>
            <View style={styles.fullWidthButton}>
              <Button
                label="New Sale"
                onPress={() => router.replace('/(app)/sales/new')}
                variant="primary"
                icon={<Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />}
                fullWidth
              />
            </View>
            <View style={styles.fullWidthButton}>
              <Button
                label="Back to Dashboard"
                onPress={() => router.replace('/(app)')}
                variant="ghost"
                fullWidth
              />
            </View>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  successBanner: {
    backgroundColor: '#E6EEFF',
    borderWidth: 1,
    borderColor: '#0047AB',
    borderRadius: 8,
    margin: 16,
    padding: 12,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0047AB',
  },
  receiptNumberMeta: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: '#E6EEFF',
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#C8D9FF',
  },
  metricLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
  },
  fullWidthButton: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  bottomPadding: {
    height: 40,
  },
})
