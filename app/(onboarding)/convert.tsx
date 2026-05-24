import React, { useMemo, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Button, Input } from '../../src/components/ui'
import { AnimatedRow } from '../../src/components/onboarding/AnimatedRow'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import type { BusinessType, MainChallenge } from '../../src/stores/onboardingStore'

interface Pair {
  bad: string
  good: string
}

function pairsForChallenge(mc: MainChallenge | null): Pair[] {
  const profit: Pair = {
    bad: 'Guessing your profit at month end',
    good: 'Seeing your exact profit every day',
  }
  const stock: Pair = {
    bad: 'Discovering missing stock during stocktake',
    good: 'Getting an alert before stock runs out',
  }
  const debts: Pair = {
    bad: 'Customers disputing credit in the notebook',
    good: 'Every debt recorded with a date and receipt',
  }
  const generic: Pair = {
    bad: 'Losing records if your phone or notebook is lost',
    good: 'Data automatically backed up — never lost',
  }

  if (mc === 'all') return [profit, stock, debts]
  if (mc === 'profit') return [profit, generic]
  if (mc === 'stock') return [stock, generic]
  if (mc === 'debts') return [debts, generic]
  return [profit, generic]
}

function placeholderBusiness(bt: BusinessType | null): string {
  switch (bt) {
    case 'tuck_shop':
      return "e.g. Chipo's Tuck Shop"
    case 'hardware':
      return 'e.g. Moyo Hardware'
    case 'tech_shop':
      return 'e.g. TechZone Gadgets'
    case 'salon':
      return "e.g. Tendai's Salon"
    case 'clothing':
      return 'e.g. Fashion by Rudo'
    case 'pharmacy':
      return 'e.g. Harare Pharmacy'
    case 'restaurant':
      return "e.g. Mama's Kitchen"
    case 'other':
    default:
      return 'e.g. Your Business Name'
  }
}

export default function ConvertScreen() {
  const router = useRouter()
  const businessType = useOnboardingStore((s) => s.businessType)
  const mainChallenge = useOnboardingStore((s) => s.mainChallenge)
  const businessName = useOnboardingStore((s) => s.businessName)
  const ownerName = useOnboardingStore((s) => s.ownerName)
  const setBusinessName = useOnboardingStore((s) => s.setBusinessName)
  const setOwnerName = useOnboardingStore((s) => s.setOwnerName)
  const setSignupCredentials = useOnboardingStore((s) => s.setSignupCredentials)

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreed, setAgreed] = useState(false)

  const pairList = useMemo(() => pairsForChallenge(mainChallenge), [mainChallenge])

  const submit = async () => {
    if ((businessName?.trim().length ?? 0) < 2) {
      Alert.alert('Business name', 'Please enter your business name (at least 2 characters).')
      return
    }
    if ((ownerName?.trim().length ?? 0) < 2) {
      Alert.alert('Your name', 'Please enter your name (at least 2 characters).')
      return
    }
    const ph = phone.trim()
    if (!/^07\d{8}$/.test(ph)) {
      Alert.alert('Phone number', 'Enter a valid 10-digit number starting with 07.')
      return
    }
    if (password.length < 6) {
      Alert.alert('Password', 'Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      Alert.alert('Password', 'Passwords do not match. Please check and try again.')
      return
    }
    if (!agreed) {
      Alert.alert(
        'Terms',
        'Please confirm you agree to the Terms of Service and Privacy Policy.',
      )
      return
    }

    setSignupCredentials(ph, password)
    router.push('/(onboarding)/verify-phone')
  }

  return (
    <OnboardingScreenLayout
      screenIndex={8}
      footer={
        <View style={styles.footerSection}>
          <Button
            variant="primary"
            label="Create my account"
            onPress={submit}
            size="lg"
            fullWidth
          />
          <TouchableOpacity
            style={styles.loginRow}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.loginLink}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <Text style={styles.title}>Your business is about to get clearer</Text>

      {pairList.map((pair, idx) => (
        <AnimatedRow key={`${pair.bad}-${idx}`} delay={idx * 120}>
          <View style={styles.pairBlock}>
            <View style={styles.badRow}>
              <View style={styles.badIcon}>
                <Ionicons name="close" size={14} color="#C0152A" />
              </View>
              <Text style={styles.badText}>{pair.bad}</Text>
            </View>
            <View style={styles.arrowRow}>
              <Ionicons name="arrow-down" size={14} color="#DDE3F0" />
            </View>
            <View style={styles.goodRow}>
              <View style={styles.goodIcon}>
                <Ionicons name="checkmark" size={14} color="#0A7A4B" />
              </View>
              <Text style={styles.goodText}>{pair.good}</Text>
            </View>
          </View>
        </AnimatedRow>
      ))}

      <View style={styles.dividerWrap}>
        <View style={styles.divLine} />
        <Text style={styles.divLabel}>Create your account</Text>
        <View style={styles.divLine} />
      </View>

      <Input
        label="Business Name"
        placeholder={placeholderBusiness(businessType)}
        value={businessName}
        onChangeText={setBusinessName}
        autoCapitalize="words"
        leftIcon={<Ionicons name="business-outline" size={18} color="#5A6A8A" />}
      />

      <View style={styles.gap} />

      <Input
        label="Your Name"
        placeholder="e.g. Chipo Moyo"
        value={ownerName}
        onChangeText={setOwnerName}
        autoCapitalize="words"
        leftIcon={<Ionicons name="person-outline" size={18} color="#5A6A8A" />}
      />

      <View style={styles.gap} />

      <Input
        label="Phone Number"
        placeholder="e.g. 0771234567"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        hint="This will be your login number — we will send a verification code by SMS"
        leftIcon={<Ionicons name="call-outline" size={18} color="#5A6A8A" />}
      />

      <View style={styles.gap} />

      <Input
        label="Password"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        hint="Minimum 6 characters"
      />

      <View style={styles.gap} />

      <Input
        label="Confirm Password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        hint="Must match the password above"
      />

      <View style={styles.gap} />

      <TouchableOpacity
        style={styles.legalRow}
        onPress={() => setAgreed((prev) => !prev)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
      >
        <Ionicons
          name={agreed ? 'checkbox' : 'square-outline'}
          size={22}
          color="#0047AB"
        />
        <Text style={styles.legalText}>
          I have read and agree to the Terms of Service and Privacy Policy.
        </Text>
      </TouchableOpacity>

      <View style={styles.legalLinksRow}>
        <TouchableOpacity onPress={() => router.push('/(onboarding)/terms-of-service')}>
          <Text style={styles.linkSmall}>Terms of Service</Text>
        </TouchableOpacity>
        <Text style={styles.linkSep}> · </Text>
        <TouchableOpacity onPress={() => router.push('/(onboarding)/privacy-policy')}>
          <Text style={styles.linkSmall}>Privacy Policy</Text>
        </TouchableOpacity>
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
    marginBottom: 16,
  },
  pairBlock: {
    marginBottom: 14,
  },
  badRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  badIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FCEBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badText: {
    flex: 1,
    fontSize: 13,
    color: '#5A6A8A',
  },
  arrowRow: {
    marginLeft: 26,
    marginVertical: 2,
  },
  goodRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  goodIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EAF3DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goodText: {
    flex: 1,
    fontSize: 13,
    color: '#0A7A4B',
    fontWeight: '500',
  },
  dividerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 28,
  },
  divLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#DDE3F0',
  },
  divLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  gap: {
    height: 16,
  },
  footerSection: {
    marginTop: 4,
    paddingTop: 4,
  },
  legalRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 20,
  },
  legalText: {
    flex: 1,
    fontSize: 13,
    color: '#0D1B3E',
    lineHeight: 18,
  },
  linkSmall: {
    fontSize: 13,
    color: '#0047AB',
    fontWeight: '600',
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 28,
    gap: 4,
  },
  linkSep: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  loginRow: {
    marginTop: 22,
    alignItems: 'center',
  },
  loginLink: {
    fontSize: 13,
    color: '#0047AB',
    textAlign: 'center',
  },
})
