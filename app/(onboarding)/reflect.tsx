import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../../src/components/ui'
import { AnimatedRow } from '../../src/components/onboarding/AnimatedRow'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import type { BusinessType, MainChallenge, TrackingMethod } from '../../src/stores/onboardingStore'

function businessLabel(t: BusinessType | null): string {
  const m: Record<BusinessType, string> = {
    tuck_shop: 'tuck shop',
    hardware: 'hardware store',
    tech_shop: 'tech shop',
    salon: 'salon or barber shop',
    clothing: 'clothing shop',
    pharmacy: 'pharmacy',
    restaurant: 'restaurant or takeaway',
    other: 'business',
  }
  return t ? m[t] : 'business'
}

function trackingLabel(m: TrackingMethod | null): string {
  const map: Record<TrackingMethod, string> = {
    notebook: 'a notebook',
    whatsapp: 'WhatsApp messages',
    excel: 'Excel or a spreadsheet',
    none: 'no system at all',
  }
  return m ? map[m] : 'your records'
}

function challengeLabel(c: MainChallenge | null): string {
  const map: Record<MainChallenge, string> = {
    profit: 'knowing your real profit',
    stock: 'keeping track of stock',
    debts: 'collecting money owed by customers',
    all: 'profit, stock, and customer debts',
  }
  return c ? map[c] : 'running smoothly'
}

function situationText(tm: TrackingMethod | null): string {
  switch (tm) {
    case 'notebook':
      return 'With a notebook: losses from theft, damage, or unrecorded sales are almost impossible to trace after the fact.'
    case 'whatsapp':
      return 'With WhatsApp: messages get deleted, misread, or lost — and there is no way to run a report on them.'
    case 'excel':
      return 'With a spreadsheet: it only works when you remember to update it — and it cannot alert you when stock runs low.'
    case 'none':
      return 'Without any system: you are running your business blind. Every day, money and stock are slipping through unnoticed.'
    default:
      return ''
  }
}

function solutionText(ch: MainChallenge | null): string {
  switch (ch) {
    case 'profit':
      return 'With Profit Protector: see your exact profit every single day — after all costs, losses, and debts are accounted for.'
    case 'stock':
      return 'With Profit Protector: every item in and out is logged instantly. You will know exactly what happened, when, and why.'
    case 'debts':
      return 'With Profit Protector: every credit sale is recorded with a date and amount. No more disputes — the record is always clear.'
    case 'all':
      return 'With Profit Protector: profit, stock, and customer debts — all tracked automatically in one place, from your phone.'
    default:
      return ''
  }
}

export default function ReflectScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const trackingMethod = useOnboardingStore((s) => s.trackingMethod)
  const mainChallenge = useOnboardingStore((s) => s.mainChallenge)

  const bt = businessLabel(businessType)
  const tr = trackingLabel(trackingMethod)
  const ch = challengeLabel(mainChallenge)

  return (
    <OnboardingScreenLayout
      screenIndex={3}
      showSkip
      footer={
        <Button
          variant="primary"
          label="Show me how"
          onPress={() => router.push('/(onboarding)/aha')}
          size="lg"
          fullWidth
        />
      }
    >
      <Text style={styles.title}>Here is what we noticed</Text>

      <View style={styles.profileCard}>
        <Text style={styles.profileLabel}>Your profile</Text>
        <Text style={styles.profileLine}>
          You run a{' '}
          <Text style={styles.highlight}>{bt}</Text>
          {' '}and currently track using{' '}
          <Text style={styles.highlight}>{tr}</Text>.
        </Text>
        <Text style={[styles.profileLine, styles.profileLine2]}>
          Your biggest challenge is <Text style={styles.highlight}>{ch}</Text>.
        </Text>
      </View>

      <AnimatedRow delay={300}>
        <View style={[styles.resultRow, styles.resultBad]}>
          <Ionicons name="close-circle" size={20} color="#C0152A" style={styles.resultIcon} />
          <Text style={styles.resultText}>{situationText(trackingMethod)}</Text>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={500}>
        <View style={[styles.resultRow, styles.resultGood]}>
          <Ionicons name="checkmark-circle" size={20} color="#0A7A4B" style={styles.resultIcon} />
          <Text style={styles.resultText}>{solutionText(mainChallenge)}</Text>
        </View>
      </AnimatedRow>
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
  profileCard: {
    backgroundColor: '#E6EEFF',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 71, 171, 0.3)',
  },
  profileLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#0047AB',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  profileLine: {
    fontSize: 14,
    color: '#0D1B3E',
    lineHeight: 14 * 1.8,
  },
  profileLine2: {
    marginTop: 6,
  },
  highlight: {
    color: '#0047AB',
    fontWeight: '500',
  },
  resultRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  resultBad: {
    backgroundColor: '#FCEBEB',
  },
  resultGood: {
    backgroundColor: '#EAF3DE',
  },
  resultIcon: {
    marginTop: 2,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    color: '#0D1B3E',
    lineHeight: 13 * 1.55,
  },
})
