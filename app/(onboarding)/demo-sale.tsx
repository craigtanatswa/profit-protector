import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '../../src/components/ui'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import {
  computeDemoTotals,
  getDemoProductsForBusinessType,
} from '../../src/lib/onboardingDemoProducts'

type Pay = 'cash' | 'eco' | 'credit'

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function DemoSaleScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const rows = getDemoProductsForBusinessType(businessType)
  const totals = computeDemoTotals(rows)
  const [pay, setPay] = React.useState<Pay>('cash')

  const glow = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [glow])

  const borderOpacity = glow

  const onComplete = () => router.push('/(onboarding)/demo-result')

  return (
    <OnboardingScreenLayout
      screenIndex={5}
      showSkip
      footer={
        <View>
          <Text style={styles.demoNote}>This is a demo — no data will be saved yet</Text>
          <Animated.View
            style={[
              styles.ctaGlow,
              {
                shadowOpacity: borderOpacity,
              },
            ]}
          >
            <Button
              variant="primary"
              label={`Complete sale — ${formatUsdFromCents(totals.totalRevenue)}`}
              onPress={onComplete}
              size="lg"
              fullWidth
            />
          </Animated.View>
        </View>
      }
    >
      <Text style={styles.title}>Try it — record a sale</Text>
      <Text style={styles.subtitle}>Tap &apos;Complete sale&apos; to see how it works</Text>

      <View style={styles.cart}>
        {rows.map((r, idx) => (
          <View
            key={r.name}
            style={[styles.lineRow, idx < rows.length - 1 && styles.lineBorder]}
          >
            <View style={styles.lineLeft}>
              <Text style={styles.prodName}>{r.name}</Text>
              <Text style={styles.prodPrice}>{formatUsdFromCents(r.price)} each</Text>
            </View>
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyText}>× {r.qty}</Text>
            </View>
          </View>
        ))}
        <View style={[styles.lineRow, styles.totalRow]}>
          <Text style={styles.totalLab}>Total</Text>
          <Text style={styles.totalAmt}>{formatUsdFromCents(totals.totalRevenue)}</Text>
        </View>

        <View style={styles.payRow}>
          <TouchableOpacity
            onPress={() => setPay('cash')}
            style={[styles.payPill, pay === 'cash' && styles.payPillOn]}
          >
            <Text style={[styles.payTxt, pay === 'cash' && styles.payTxtOn]}>Cash $</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setPay('eco')}
            style={[styles.payPill, pay === 'eco' && styles.payPillOn]}
          >
            <Text style={[styles.payTxt, pay === 'eco' && styles.payTxtOn]}>EcoCash</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setPay('credit')}
            style={[styles.payPill, pay === 'credit' && styles.payPillOn]}
          >
            <Text style={[styles.payTxt, pay === 'credit' && styles.payTxtOn]}>Credit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </OnboardingScreenLayout>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: '#0D1B3E',
    marginTop: 24,
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    marginBottom: 16,
    marginTop: 8,
  },
  cart: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    overflow: 'hidden',
    marginBottom: 16,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  lineBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  lineLeft: {
    flex: 1,
  },
  prodName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  prodPrice: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  qtyBadge: {
    backgroundColor: '#E6EEFF',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  qtyText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0047AB',
  },
  totalRow: {
    paddingTop: 4,
  },
  totalLab: {
    fontSize: 14,
    color: '#5A6A8A',
  },
  totalAmt: {
    fontSize: 18,
    fontWeight: '500',
    color: '#0047AB',
  },
  payRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  payPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
  },
  payPillOn: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  payTxt: {
    fontSize: 13,
    color: '#5A6A8A',
    fontWeight: '500',
  },
  payTxtOn: {
    color: '#FFFFFF',
  },
  demoNote: {
    fontSize: 12,
    color: '#5A6A8A',
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaGlow: {
    shadowColor: '#0047AB',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    elevation: 6,
  },
})
