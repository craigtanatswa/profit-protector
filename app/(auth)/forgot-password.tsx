/*
 * Forgot password looks up `businesses` by phone (public read may require RLS policy
 * or a security definer RPC). Example RPC:
 *
 * create or replace function public.lookup_recovery_by_phone(p_phone text)
 * returns table (recovery_email text, recovery_email_verified boolean, user_id uuid)
 * language sql security definer set search_path = public as $$
 *   select recovery_email, recovery_email_verified, user_id
 *   from businesses where phone = p_phone limit 1;
 * $$;
 * grant execute on function public.lookup_recovery_by_phone(text) to anon, authenticated;
 */

import React, { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { Ionicons } from '@expo/vector-icons'

import { Button, Input } from '../../src/components/ui'
import { EmailVerificationModal } from '../../src/components/auth/EmailVerificationModal'
import { ScreenHeader } from '../../src/components/layout'
import { supabase } from '../../src/lib/supabase'
import { isMissingRecoveryColumnsError } from '../../src/lib/businessRemote'
import { maskEmail } from '../../src/lib/formatters'
import { completeRecoveryPassword, sendRecoveryOtp } from '../../src/lib/emailOTP'

const SUPPORT_WHATSAPP_URL = 'https://wa.me/YOUR_WHATSAPP_NUMBER'

const phoneSchema = z.object({
  phone: z
    .string()
    .length(10, 'Phone number must be 10 digits')
    .regex(/^07/, 'Phone number must start with 07'),
})

type PhoneForm = z.infer<typeof phoneSchema>

const passwordSchema = z
  .object({
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type PasswordForm = z.infer<typeof passwordSchema>

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [submittedPhone, setSubmittedPhone] = useState('')
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null)
  const [otpVisible, setOtpVisible] = useState(false)
  const [otpPrimed, setOtpPrimed] = useState(false)
  const [savingPass, setSavingPass] = useState(false)

  const phoneForm = useForm<PhoneForm>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '' },
  })

  const passForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    if (step !== 2 || otpPrimed || !recoveryEmail || !submittedPhone) return
    let cancelled = false
    ;(async () => {
      const result = await sendRecoveryOtp(submittedPhone, recoveryEmail)
      if (cancelled) return
      if (!result.success) {
        Alert.alert('Could not send code', result.error ?? 'Please try again.')
        setStep(1)
        return
      }
      setOtpVisible(true)
      setOtpPrimed(true)
    })()
    return () => {
      cancelled = true
    }
  }, [step, otpPrimed, recoveryEmail, submittedPhone])

  async function onPhoneSubmit(values: PhoneForm) {
    const { data, error } = await supabase
      .from('businesses')
      .select('recovery_email, recovery_email_verified, user_id')
      .eq('phone', values.phone)
      .maybeSingle()

    if (error) {
      if (isMissingRecoveryColumnsError(error)) {
        Alert.alert(
          'Recovery not available',
          'Email-based recovery is not set up on your server yet. Contact support to reset your password, or add the recovery email columns in Supabase (see app Settings comments).',
        )
        return
      }
      Alert.alert('Error', error.message)
      return
    }

    if (!data) {
      Alert.alert('Not found', 'No account found with this phone number.')
      return
    }

    const emailRaw = typeof data.recovery_email === 'string' ? data.recovery_email.trim() : ''
    if (!emailRaw || data.recovery_email_verified !== true) {
      Alert.alert(
        'No Recovery Email',
        'This account does not have a verified recovery email. Please contact support on WhatsApp to reset your password.\n\nTo protect your account in future, add a recovery email in Settings after logging in.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Contact Support',
            onPress: () => Linking.openURL(SUPPORT_WHATSAPP_URL),
          },
        ],
      )
      return
    }

    setRecoveryEmail(emailRaw)
    setMaskedEmail(maskEmail(emailRaw))
    setSubmittedPhone(values.phone.trim())
    setOtpPrimed(false)
    setStep(2)
  }

  function onOtpSuccess(info?: { recoveryToken?: string }) {
    setOtpVisible(false)
    if (info?.recoveryToken) {
      setRecoveryToken(info.recoveryToken)
      setStep(3)
      return
    }
    Alert.alert('Verification failed', 'Could not start password reset. Please try again.')
    setStep(1)
  }

  function onOtpCancel() {
    setOtpVisible(false)
    setStep(1)
    setOtpPrimed(false)
    setRecoveryEmail('')
    setSubmittedPhone('')
  }

  async function onSavePassword(values: PasswordForm) {
    if (!recoveryToken) {
      Alert.alert('Session expired', 'Please verify the code again.')
      return
    }
    setSavingPass(true)
    try {
      const { success, error } = await completeRecoveryPassword(recoveryToken, values.newPassword)
      if (!success) {
        Alert.alert('Error', error ?? 'Could not update password.')
        setSavingPass(false)
        return
      }
      setRecoveryToken(null)
      Alert.alert('Password updated', 'You can now log in with your new password.', [
        {
          text: 'Login',
          onPress: () => router.replace('/(auth)/login'),
        },
      ])
    } catch (e) {
      Alert.alert('Error', (e as Error)?.message ?? 'Could not update password.')
    } finally {
      setSavingPass(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Recover Account"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 ? (
            <>
              <View style={styles.iconCircle}>
                <Ionicons name="key-outline" size={48} color="#0047AB" />
              </View>
              <Text style={styles.title}>Recover Your Account</Text>
              <Text style={styles.subtitle}>Enter your registered phone number</Text>

              <Controller
                control={phoneForm.control}
                name="phone"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="Phone Number"
                    placeholder="e.g. 0771234567"
                    value={value}
                    onChangeText={onChange}
                    error={phoneForm.formState.errors.phone?.message}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                  />
                )}
              />

              <View style={styles.btn}>
                <Button
                  label="Continue"
                  onPress={phoneForm.handleSubmit(onPhoneSubmit)}
                  variant="primary"
                  size="lg"
                  fullWidth
                />
              </View>
            </>
          ) : null}

          {step === 2 && !otpVisible ? (
            <View style={styles.centerBlock}>
              <Text style={styles.subtitle}>Sending a code to</Text>
              <Text style={styles.masked}>{maskedEmail}</Text>
            </View>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.title}>Set New Password</Text>
              <Controller
                control={passForm.control}
                name="newPassword"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="New Password"
                    placeholder="At least 6 characters"
                    value={value}
                    onChangeText={onChange}
                    error={passForm.formState.errors.newPassword?.message}
                    secureTextEntry
                    autoCapitalize="none"
                    editable={!savingPass}
                  />
                )}
              />
              <Controller
                control={passForm.control}
                name="confirmPassword"
                render={({ field: { onChange, value } }) => (
                  <Input
                    label="Confirm New Password"
                    placeholder="Repeat password"
                    value={value}
                    onChangeText={onChange}
                    error={passForm.formState.errors.confirmPassword?.message}
                    secureTextEntry
                    autoCapitalize="none"
                    editable={!savingPass}
                  />
                )}
              />
              <View style={styles.btn}>
                <Button
                  label={savingPass ? 'Saving...' : 'Save New Password'}
                  onPress={passForm.handleSubmit(onSavePassword)}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={savingPass}
                  disabled={savingPass}
                />
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <EmailVerificationModal
        visible={otpVisible}
        email={recoveryEmail}
        emailDisplay={maskedEmail}
        purpose="recovery"
        recoveryPhone={submittedPhone}
        onSuccess={onOtpSuccess}
        onCancel={onOtpCancel}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginBottom: 8,
    alignSelf: 'stretch',
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    marginBottom: 32,
    alignSelf: 'stretch',
  },
  masked: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
    textAlign: 'center',
  },
  centerBlock: {
    marginTop: 48,
    alignItems: 'center',
  },
  btn: {
    marginTop: 24,
    alignSelf: 'stretch',
    width: '100%',
  },
})
