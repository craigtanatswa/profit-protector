import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '../../src/components/ui'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import type { BusinessType, MainChallenge } from '../../src/stores/onboardingStore'

function subtitleFor(bt: BusinessType | null): string {
  switch (bt) {
    case 'hardware':
      return 'A typical day for a hardware store:'
    case 'tech_shop':
      return 'A typical day for a tech shop:'
    case 'salon':
      return 'A typical day for a salon:'
    case 'clothing':
      return 'A typical day for a clothing shop:'
    case 'pharmacy':
      return 'A typical day for a pharmacy:'
    case 'restaurant':
      return 'A typical day for a restaurant:'
    case 'tuck_shop':
    case 'other':
    default:
      return 'A typical day for a tuck shop:'
  }
}

function row3Label(mc: MainChallenge | null): string {
  if (mc === 'stock' || mc === 'all') return 'Stock lost (damage/theft)'
  if (mc === 'debts') return 'Credit not yet collected'
  if (mc === 'profit') return 'Unrecorded expenses'
  return 'Hidden losses'
}

export default function AhaScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const mainChallenge = useOnboardingStore((s) => s.mainChallenge)

  const [show2, setShow2] = useState(false)
  const [show3, setShow3] = useState(false)
  const [showDivider, setShowDivider] = useState(false)
  const [showFinal, setShowFinal] = useState(false)
  const [profitDisplay, setProfitDisplay] = useState(44)
  const [showInsight, setShowInsight] = useState(false)
  const [showCta, setShowCta] = useState(false)
  const ctaScale = useRef(new Animated.Value(0.92)).current

  useEffect(() => {
    const t2 = setTimeout(() => setShow2(true), 500)
    const t3 = setTimeout(() => setShow3(true), 1000)
    const td = setTimeout(() => setShowDivider(true), 1400)
    const tf = setTimeout(() => setShowFinal(true), 1600)
    const ti = setTimeout(() => setShowInsight(true), 2200)
    const tc = setTimeout(() => {
      setShowCta(true)
      Animated.spring(ctaScale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }).start()
    }, 2500)

    return () => {
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(td)
      clearTimeout(tf)
      clearTimeout(ti)
      clearTimeout(tc)
    }
  }, [ctaScale])

  useEffect(() => {
    if (!showFinal) return
    let start = Date.now()
    const duration = 700
    let frame: number
    const tick = () => {
      const elapsed = Date.now() - start
      const p = Math.min(1, elapsed / duration)
      const v = 44 + (28 - 44) * Easing.out(Easing.quad)(p)
      setProfitDisplay(Math.round(v * 100) / 100)
      if (p < 1) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [showFinal])

  return (
    <OnboardingScreenLayout
      screenIndex={4}
      showSkip
      footer={
        showCta ? (
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
            <Button
              variant="primary"
              label="I want to see my real profit"
              onPress={() => router.push('/(onboarding)/demo-sale')}
              size="lg"
              fullWidth
            />
          </Animated.View>
        ) : (
          <View style={{ height: 56 }} />
        )
      }
    >
      <Text style={styles.title}>The number most business owners never see</Text>
      <Text style={styles.subtitle}>{subtitleFor(businessType)}</Text>

      <View style={styles.card}>
        <View style={styles.calcRow}>
          <Text style={styles.calcLeft}>Sales collected</Text>
          <Text style={styles.calcRightBlue}>$142.00</Text>
        </View>
        {show2 && (
          <View style={styles.calcRow}>
            <Text style={styles.calcLeft}>Cost of goods sold</Text>
            <Text style={styles.calcRed}>− $98.00</Text>
          </View>
        )}
        {show3 && (
          <View style={styles.calcRow}>
            <Text style={styles.calcLeft}>{row3Label(mainChallenge)}</Text>
            <Text style={styles.calcRed}>− $16.00</Text>
          </View>
        )}
        {showDivider && <View style={styles.divider} />}
        {showFinal && (
          <View style={[styles.calcRow, styles.finalRow]}>
            <Text style={styles.finalLeft}>Your real profit</Text>
            <Text style={styles.finalRight}>
              $
              {profitDisplay.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </View>
        )}
      </View>

      {showInsight && (
        <View style={styles.insight}>
          <Text style={styles.insightText}>
            Without a system, most owners think they made $44. The real number is $28. That is a $16 difference —
            every single day. In a month, that is $480 lost.
          </Text>
        </View>
      )}
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
    marginBottom: 20,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 12,
    padding: 16,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  calcLeft: {
    fontSize: 14,
    color: '#0D1B3E',
  },
  calcRightBlue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0047AB',
  },
  calcRed: {
    fontSize: 14,
    color: '#C0152A',
  },
  divider: {
    height: 1,
    backgroundColor: '#DDE3F0',
    marginVertical: 8,
  },
  finalRow: {
    paddingTop: 4,
  },
  finalLeft: {
    fontSize: 15,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  finalRight: {
    fontSize: 22,
    fontWeight: '500',
    color: '#3B6D11',
  },
  insight: {
    backgroundColor: '#FAEEDA',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  insightText: {
    fontSize: 13,
    color: '#854F0B',
    lineHeight: 13 * 1.7,
  },
})
