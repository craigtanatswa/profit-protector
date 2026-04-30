import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '../../src/components/ui'
import { PillSelector } from '../../src/components/onboarding/PillSelector'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import type { BusinessType, MainChallenge, TrackingMethod } from '../../src/stores/onboardingStore'

const BT: { value: BusinessType; label: string }[] = [
  { value: 'tuck_shop', label: 'Tuck shop / Grocery' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'tech_shop', label: 'Tech shop / Gadgets' },
  { value: 'salon', label: 'Salon / Barber' },
  { value: 'clothing', label: 'Clothing / Boutique' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'restaurant', label: 'Restaurant / Takeaway' },
  { value: 'other', label: 'Other' },
]

const TM: { value: TrackingMethod; label: string }[] = [
  { value: 'notebook', label: 'Notebook' },
  { value: 'whatsapp', label: 'WhatsApp messages' },
  { value: 'excel', label: 'Excel / Spreadsheet' },
  { value: 'none', label: "I don't track" },
]

const MC: { value: MainChallenge; label: string }[] = [
  { value: 'profit', label: 'Not knowing my profit' },
  { value: 'stock', label: 'Losing track of stock' },
  { value: 'debts', label: 'Customers owing money' },
  { value: 'all', label: 'All of these' },
]

export default function PersonaliseScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const trackingMethod = useOnboardingStore((s) => s.trackingMethod)
  const mainChallenge = useOnboardingStore((s) => s.mainChallenge)
  const setBusinessType = useOnboardingStore((s) => s.setBusinessType)
  const setTrackingMethod = useOnboardingStore((s) => s.setTrackingMethod)
  const setMainChallenge = useOnboardingStore((s) => s.setMainChallenge)

  const ready =
    businessType != null && trackingMethod != null && mainChallenge != null

  const scale = useRef(new Animated.Value(ready ? 1 : 0.95)).current

  useEffect(() => {
    Animated.spring(scale, {
      toValue: ready ? 1 : 0.95,
      friction: 6,
      useNativeDriver: true,
    }).start()
  }, [ready, scale])

  const onContinue = () => {
    if (!ready) return
    router.push('/(onboarding)/reflect')
  }

  return (
    <OnboardingScreenLayout
      screenIndex={2}
      showSkip
      footer={
        <Animated.View style={{ transform: [{ scale }] }}>
          <Button
            variant="primary"
            label="Continue"
            onPress={onContinue}
            size="lg"
            fullWidth
            disabled={!ready}
          />
        </Animated.View>
      }
    >
      <Text style={styles.title}>Tell us about your business</Text>
      <Text style={styles.subtitle}>3 quick questions — tap to answer</Text>

      <Text style={styles.qLabel}>What type of business do you run?</Text>
      <PillSelector
        options={BT}
        selected={businessType}
        onSelect={(v) => setBusinessType(v as BusinessType)}
      />

      <Text style={[styles.qLabel, styles.qSpacer]}>How do you currently track sales?</Text>
      <PillSelector
        options={TM}
        selected={trackingMethod}
        onSelect={(v) => setTrackingMethod(v as TrackingMethod)}
      />

      <Text style={[styles.qLabel, styles.qSpacer]}>What is your biggest challenge?</Text>
      <PillSelector
        options={MC}
        selected={mainChallenge}
        onSelect={(v) => setMainChallenge(v as MainChallenge)}
      />
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
    marginBottom: 28,
    marginTop: 8,
  },
  qLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
    letterSpacing: 0.52,
    marginBottom: 10,
  },
  qSpacer: {
    marginTop: 24,
  },
})
