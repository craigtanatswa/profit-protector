import React, { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button, Card, Input, OTPInput } from '../../src/components/ui'
import { ScreenHeader } from '../../src/components/layout'
import { sendPhoneOtp, verifyPhoneOtpForSession } from '../../src/lib/phoneOTP'
import { supabase } from '../../src/lib/supabase'

const phoneSchema = z.object({
  phone: z
    .string()
    .length(10, 'Phone number must be 10 digits')
    .regex(/^07/, 'Phone number must start with 07'),
})

type PhoneForm = z.infer<typeof phoneSchema>

export default function PhoneVerifyScreen() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [submittedPhone, setSubmittedPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  const phoneForm = useForm<PhoneForm>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '' },
  })

  async function onSendCode(values: PhoneForm) {
    setLoading(true)
    try {
      const result = await sendPhoneOtp(values.phone)
      if (!result.success) {
        Alert.alert('Could not send code', result.error ?? 'Please try again.')
        return
      }
      setSubmittedPhone(values.phone)
      setStep(2)
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  async function onVerifyCode() {
    const len = otp.trim().length
    if (len !== 4) {
      Alert.alert('Enter code', 'Enter the 4-digit verification code from your SMS.')
      return
    }
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        Alert.alert(
          'Sign in required',
          'Open this flow from your account settings after you are logged in.',
        )
        return
      }
      const result = await verifyPhoneOtpForSession(submittedPhone, otp.trim())
      if (!result.success) {
        Alert.alert('Verification failed', result.error ?? 'Please try again.')
        return
      }
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  function goBack() {
    if (step === 2) {
      setStep(1)
      setOtp('')
      return
    }
    router.back()
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Phone verification"
        leftAction={{ icon: 'arrow-back', onPress: goBack }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {step === 1 && (
            <Card style={styles.card}>
              <Text style={styles.lead}>
                Enter your Zimbabwe mobile number. We will send a one-time code by SMS.
              </Text>
              <Controller
                control={phoneForm.control}
                name="phone"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="Phone number"
                    placeholder="0771234567"
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    maxLength={10}
                    value={value}
                    onChangeText={onChange}
                    error={phoneForm.formState.errors.phone?.message}
                  />
                )}
              />
              <Button
                label="Send code"
                onPress={phoneForm.handleSubmit(onSendCode)}
                loading={loading}
                fullWidth
              />
            </Card>
          )}

          {step === 2 && (
            <Card style={styles.card}>
              <Text style={styles.lead}>
                Enter the verification code we sent to{' '}
                <Text style={styles.phoneHighlight}>{submittedPhone}</Text>.
              </Text>
              <OTPInput value={otp} onChange={setOtp} error={undefined} disabled={loading} length={4} />
              <Button
                label="Verify"
                onPress={onVerifyCode}
                loading={loading}
                disabled={otp.trim().length !== 4}
                fullWidth
              />
              <Button
                label="Resend code"
                variant="ghost"
                onPress={async () => {
                  setLoading(true)
                  try {
                    const result = await sendPhoneOtp(submittedPhone)
                    if (!result.success) {
                      Alert.alert('Could not send code', result.error ?? 'Please try again.')
                    }
                  } finally {
                    setLoading(false)
                  }
                }}
                loading={loading}
                fullWidth
              />
            </Card>
          )}

          {step === 3 && (
            <Card style={styles.card}>
              <Text style={styles.successTitle}>Verified</Text>
              <Text style={styles.lead}>
                Your phone number has been verified successfully.
              </Text>
              <Button label="Done" onPress={() => router.back()} fullWidth />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  card: {
    paddingVertical: 20,
    gap: 16,
  },
  lead: {
    fontSize: 15,
    color: '#4A5568',
    lineHeight: 22,
  },
  phoneHighlight: {
    fontWeight: '600',
    color: '#2D3748',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0047AB',
    marginBottom: 4,
  },
})
