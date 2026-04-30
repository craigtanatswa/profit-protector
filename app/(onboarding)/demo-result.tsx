import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../../src/components/ui'
import { AnimatedRow } from '../../src/components/onboarding/AnimatedRow'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import {
  computeDemoTotals,
  getDemoProductsForBusinessType,
} from '../../src/lib/onboardingDemoProducts'

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function DemoResultScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const rows = getDemoProductsForBusinessType(businessType)
  const { totalRevenue, totalProfit } = computeDemoTotals(rows)

  return (
    <OnboardingScreenLayout
      screenIndex={6}
      showSkip
      footer={
        <Button
          variant="primary"
          label="This is exactly what I need"
          onPress={() => router.push('/(onboarding)/trust')}
          size="lg"
          fullWidth
        />
      }
    >
      <View style={styles.center}>
        <View style={styles.greenCircle}>
          <Ionicons name="checkmark" size={32} color="#0A7A4B" />
        </View>
        <Text style={styles.successTitle}>Sale recorded!</Text>
        <Text style={styles.successSub}>Here is what happened automatically:</Text>
      </View>

      <AnimatedRow delay={200}>
        <View style={[styles.resRow, styles.resBorder]}>
          <View style={[styles.ico, styles.icoGreen]}>
            <Ionicons name="receipt-outline" size={20} color="#0A7A4B" />
          </View>
          <View style={styles.resMid}>
            <Text style={styles.resLab}>Sale recorded</Text>
          </View>
          <Text style={styles.resValGreen}>{formatUsdFromCents(totalRevenue)}</Text>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={400}>
        <View style={[styles.resRow, styles.resBorder]}>
          <View style={[styles.ico, styles.icoGreen]}>
            <Ionicons name="cube-outline" size={20} color="#0A7A4B" />
          </View>
          <View style={styles.resMid}>
            <Text style={styles.resLab}>Stock updated automatically</Text>
          </View>
          <Text style={styles.resValGreen}>3 products</Text>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={600}>
        <View style={[styles.resRow, styles.resBorder]}>
          <View style={[styles.ico, styles.icoGreen]}>
            <Ionicons name="trending-up-outline" size={20} color="#0A7A4B" />
          </View>
          <View style={styles.resMid}>
            <Text style={styles.resLab}>Profit calculated</Text>
          </View>
          <Text style={styles.resValGreen}>{formatUsdFromCents(totalProfit)}</Text>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={800}>
        <View style={styles.resRow}>
          <View style={[styles.ico, styles.icoBlue]}>
            <Ionicons name="share-outline" size={20} color="#0047AB" />
          </View>
          <View style={styles.resMid}>
            <Text style={styles.resLab}>Receipt ready to share</Text>
          </View>
          <Text style={styles.resValBlue}>WhatsApp / Print</Text>
        </View>
      </AnimatedRow>

      <View style={styles.stockCard}>
        <Text style={styles.stockLab}>Stock reduced:</Text>
        {rows.map((r) => {
          const afterQty = 8
          const beforeQty = r.qty + afterQty
          return (
            <Text key={r.name} style={styles.stockLine}>
              {r.name}: {beforeQty} → {afterQty}
            </Text>
          )
        })}
      </View>

      <Text style={styles.caption}>
        No notebook. No WhatsApp message. No forgetting.
      </Text>
    </OnboardingScreenLayout>
  )
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  greenCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EAF3DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '500',
    color: '#0D1B3E',
    marginTop: 12,
  },
  successSub: {
    fontSize: 14,
    color: '#5A6A8A',
    marginTop: 6,
  },
  resRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  resBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  ico: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icoGreen: {
    backgroundColor: '#EAF3DE',
  },
  icoBlue: {
    backgroundColor: '#E6EEFF',
  },
  resMid: {
    flex: 1,
  },
  resLab: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  resValGreen: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0A7A4B',
  },
  resValBlue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0047AB',
  },
  stockCard: {
    backgroundColor: '#F4F6FB',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  stockLab: {
    fontSize: 12,
    color: '#5A6A8A',
    marginBottom: 4,
  },
  stockLine: {
    fontSize: 12,
    color: '#0D1B3E',
    lineHeight: 12 * 1.8,
  },
  caption: {
    fontSize: 13,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 12,
  },
})
