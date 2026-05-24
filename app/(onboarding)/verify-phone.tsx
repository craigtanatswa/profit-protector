import React, { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button, OTPInput } from '../../src/components/ui'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'
import { useOnboardingStore } from '../../src/stores/onboardingStore'
import { getPersonalisation } from '../../src/lib/appPersonalisation'
import { createBusinessProfile } from '../../src/lib/createAccount'
import { buildSupabaseEmailFromPhone } from '../../src/lib/authIdentity'
import { sendPhoneOtp, verifySignupOtp } from '../../src/lib/phoneOTP'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/stores/authStore'

function maskPhone(phone: string): string {
  if (phone.length !== 10) return phone
  return `${phone.slice(0, 3)} *** ${phone.slice(7)}`
}

export default function VerifyPhoneScreen() {
  const router = useRouter()

  const businessType = useOnboardingStore((s) => s.businessType)
  const businessName = useOnboardingStore((s) => s.businessName)
  const ownerName = useOnboardingStore((s) => s.ownerName)
  const signupPhone = useOnboardingStore((s) => s.signupPhone)
  const signupPassword = useOnboardingStore((s) => s.signupPassword)
  const clearSignupCredentials = useOnboardingStore((s) => s.clearSignupCredentials)
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding)

  const setBusiness = useAuthStore((s) => s.setBusiness)
  const setUser = useAuthStore((s) => s.setUser)

  const [smsCode, setSmsCode] = useState('')
  const [loading, setLoading] = useState(false)

  const slBusinessType = businessType ?? 'other'
  const currency =
    businessType != null ? getPersonalisation(businessType).currencyDefault : 'usd'

  useEffect(() => {
    if (!signupPhone || !signupPassword) {
      router.replace('/(onboarding)/convert')
    }
  }, [signupPhone, signupPassword, router])

  const finishSignup = async () => {
    setLoading(true)
    try {
      const result = await createBusinessProfile({
        businessName: businessName.trim(),
        ownerName: ownerName.trim(),
        phone: signupPhone,
        businessType: slBusinessType,
        currency,
      })

      if (!result.success) {
        Alert.alert('Registration Failed', result.error)
        return
      }

      await completeOnboarding()
      clearSignupCredentials()
      setBusiness(result.business)
      setUser(result.user)
      router.replace('/(app)')
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (smsCode.trim().length !== 4) {
      Alert.alert('Enter code', 'Enter the 4-digit verification code from SMS.')
      return
    }

    setLoading(true)
    try {
      const vr = await verifySignupOtp(signupPhone, smsCode.trim(), signupPassword)
      if (!vr.success) {
        Alert.alert('Verification failed', vr.error ?? 'Invalid code.')
        return
      }

      const email = buildSupabaseEmailFromPhone(signupPhone)
      const { error: siErr } = await supabase.auth.signInWithPassword({
        email,
        password: signupPassword,
      })
      if (siErr) {
        Alert.alert('Signup incomplete', siErr.message)
        return
      }

      await finishSignup()
    } finally {
      setLoading(false)
    }
  }

  if (!signupPhone || !signupPassword) {
    return null
  }

  return (
    <OnboardingScreenLayout
      screenIndex={8}
      footer={
        <View style={styles.footerSection}>
          <Button
            variant="primary"
            label="Verify SMS code"
            onPress={handleVerify}
            size="lg"
            fullWidth
            loading={loading}
            disabled={loading || smsCode.trim().length !== 4}
          />
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => router.back()}
            disabled={loading}
          >
            <Text style={styles.backLink}>Back to account details</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <Text style={styles.title}>Verify your phone number</Text>
      <Text style={styles.subtitle}>
        Send a verification code to {maskPhone(signupPhone)}, then enter it below. Your account
        is created when the code is verified and you will be signed in automatically.
      </Text>

      <Button
        variant="secondary"
        label="Send SMS verification code"
        onPress={async () => {
          setLoading(true)
          try {
            const sent = await sendPhoneOtp(signupPhone)
            if (!sent.success) {
              Alert.alert('SMS', sent.error ?? 'Could not send code.')
              return
            }
            setSmsCode('')
            Alert.alert('Code sent', 'Check your messages for the 4-digit code.')
          } finally {
            setLoading(false)
          }
        }}
        disabled={loading}
        loading={loading}
        fullWidth
      />

      <View style={styles.gap} />

      <OTPInput value={smsCode} onChange={setSmsCode} disabled={loading} length={4} />
    </OnboardingScreenLayout>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: '#0D1B3E',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    lineHeight: 20,
    marginBottom: 24,
  },
  gap: {
    height: 16,
  },
  footerSection: {
    marginTop: 4,
    paddingTop: 4,
  },
  backRow: {
    marginTop: 22,
    alignItems: 'center',
  },
  backLink: {
    fontSize: 13,
    color: '#0047AB',
    textAlign: 'center',
  },
})
