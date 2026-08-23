import React, { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader } from '../../../../src/components/layout'
import { Button, EmptyState, LoadingScreen } from '../../../../src/components/ui'
import { SubscriptionReceiptCard } from '../../../../src/components/receipts/SubscriptionReceiptCard'
import { useAuthStore } from '../../../../src/stores/authStore'
import { fetchPaymentById } from '../../../../src/lib/subscription'
import {
  printSubscriptionReceipt,
  shareSubscriptionReceipt,
} from '../../../../src/lib/subscriptionReceipt'
import type { Business, Payment } from '../../../../src/types'

export default function PaymentReceiptScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const authBusiness = useAuthStore((s) => s.business)

  const [payment, setPayment] = useState<Payment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true)
      setIsLoading(false)
      return
    }
    try {
      const row = await fetchPaymentById(id)
      if (!row || (authBusiness?.id && row.businessId !== authBusiness.id)) {
        setNotFound(true)
        return
      }
      setPayment(row)
    } catch (e) {
      console.warn('fetchPaymentById failed', e)
      setNotFound(true)
    } finally {
      setIsLoading(false)
    }
  }, [id, authBusiness?.id])

  useEffect(() => {
    void load()
  }, [load])

  const businessForReceipt: Business = {
    id: authBusiness?.id ?? '',
    name: authBusiness?.name ?? '',
    ownerName: authBusiness?.ownerName ?? '',
    phone: authBusiness?.phone ?? '',
    businessType: authBusiness?.businessType ?? '',
    currency: authBusiness?.currency ?? 'USD',
    zigRatePerUsd: authBusiness?.zigRatePerUsd ?? 1,
    createdAt: 0,
    recoveryEmail: authBusiness?.recoveryEmail,
    recoveryEmailVerified: authBusiness?.recoveryEmailVerified ?? false,
  }

  const handleShare = async () => {
    if (!payment) return
    setIsSharing(true)
    try {
      await shareSubscriptionReceipt({ payment, business: businessForReceipt })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      Alert.alert('Error', message)
    } finally {
      setIsSharing(false)
    }
  }

  const handlePrint = async () => {
    if (!payment) return
    setIsPrinting(true)
    try {
      await printSubscriptionReceipt({ payment, business: businessForReceipt })
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

  if (notFound || !payment) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ScreenHeader
          title="Payment Receipt"
          leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
          showBorder
        />
        <EmptyState
          icon="receipt-outline"
          title="Payment not found"
          subtitle="This payment could not be loaded"
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Payment Receipt"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'share-outline', onPress: () => void handleShare() }}
        showBorder
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SubscriptionReceiptCard payment={payment} business={businessForReceipt} />

        <View style={styles.actionRow}>
          <View style={styles.actionButton}>
            <Button
              label={isSharing ? 'Sharing…' : 'Share'}
              onPress={() => void handleShare()}
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
              onPress={() => void handlePrint()}
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
    paddingTop: 16,
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
  bottomPadding: {
    height: 40,
  },
})
