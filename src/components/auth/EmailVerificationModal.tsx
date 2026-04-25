import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../ui/Button'
import { OTPInput } from '../ui/OTPInput'
import {
  sendEmailOTP,
  sendRecoveryOtp,
  verifyEmailOTP,
  verifyRecoveryOTP,
} from '../../lib/emailOTP'

export type EmailVerificationPurpose =
  | 'add_email'
  | 'change_password'
  | 'change_phone'
  | 'recovery'

export interface EmailVerificationModalProps {
  visible: boolean
  /** Real email used for verifyOtp */
  email: string
  /** Optional masked / display-only line (defaults to email) */
  emailDisplay?: string
  purpose: EmailVerificationPurpose
  /** Shown above the OTP input (e.g. change password explanation) */
  explanatoryText?: string
  /** Required when purpose is `recovery` (forgot password, no session). */
  recoveryPhone?: string
  onSuccess: (info?: { recoveryToken?: string }) => void
  onCancel: () => void
}

const TITLE: Record<EmailVerificationPurpose, string> = {
  add_email: 'Verify Your Email',
  change_password: "Confirm It's You",
  change_phone: "Confirm It's You",
  recovery: 'Check Your Email',
}

export function EmailVerificationModal({
  visible,
  email,
  emailDisplay,
  purpose,
  explanatoryText,
  recoveryPhone,
  onSuccess,
  onCancel,
}: EmailVerificationModalProps) {
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const shakeAnim = useRef(new Animated.Value(0)).current

  const displayLine = emailDisplay ?? email

  useEffect(() => {
    if (!visible) {
      setOtp('')
      setError(undefined)
      setLoading(false)
      setCountdown(60)
      return
    }
    setCountdown(60)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    if (countdown <= 0) return
    const t = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1))
    }, 1000)
    return () => clearInterval(t)
  }, [visible, countdown])

  function runShake() {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start()
  }

  async function handleVerify() {
    if (otp.length !== 6 || !email) return
    if (purpose === 'recovery' && !recoveryPhone?.trim()) {
      setError('Missing phone for recovery. Close and try again.')
      return
    }
    setLoading(true)
    setError(undefined)
    if (purpose === 'recovery' && recoveryPhone) {
      const r = await verifyRecoveryOTP(recoveryPhone, email, otp)
      setLoading(false)
      if (!r.success) {
        setError(r.error)
        runShake()
        setOtp('')
        return
      }
      onSuccess(
        r.recoveryToken != null && r.recoveryToken !== ''
          ? { recoveryToken: r.recoveryToken }
          : undefined,
      )
      return
    }

    const r2 = await verifyEmailOTP(email, otp)
    setLoading(false)
    if (!r2.success) {
      setError(r2.error)
      runShake()
      setOtp('')
      return
    }
    onSuccess()
  }

  async function handleResend() {
    setError(undefined)
    const otpPurpose =
      purpose === 'change_phone' ? 'change_password' : purpose
    const result =
      purpose === 'recovery' && recoveryPhone
        ? await sendRecoveryOtp(recoveryPhone, email)
        : await sendEmailOTP(email, otpPurpose)
    if (!result.success) {
      setError(result.error ?? 'Could not resend code.')
      return
    }
    setCountdown(60)
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.root}>
          {purpose !== 'recovery' ? (
            <Pressable style={styles.closeBtn} onPress={onCancel} hitSlop={12}>
              <Ionicons name="close" size={26} color="#5A6A8A" />
            </Pressable>
          ) : (
            <View style={styles.closePlaceholder} />
          )}

          <View style={styles.iconCircle}>
            <Ionicons name="mail-outline" size={48} color="#0047AB" />
          </View>

          <Text style={styles.title}>{TITLE[purpose]}</Text>

          <Text style={styles.subtitle}>We sent a 6-digit code to</Text>
          <Text style={styles.emailLine}>{displayLine}</Text>

          {explanatoryText != null && explanatoryText !== '' ? (
            <Text style={styles.explain}>{explanatoryText}</Text>
          ) : null}

          <Animated.View style={[styles.otpWrap, { transform: [{ translateX: shakeAnim }] }]}>
            <OTPInput value={otp} onChange={setOtp} disabled={loading} error={error} />
          </Animated.View>

          <View style={styles.verifyBtn}>
            <Button
              label={loading ? 'Verifying...' : 'Verify'}
              onPress={handleVerify}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={loading || otp.length !== 6}
            />
          </View>

          <View style={styles.resendRow}>
            {countdown > 0 ? (
              <Text style={styles.resendMuted}>Resend code in {countdown}s</Text>
            ) : (
              <Text style={styles.resendMuted}>
                Didn&apos;t receive it?{' '}
                <Text style={styles.resendLink} onPress={handleResend}>
                  Resend
                </Text>
              </Text>
            )}
          </View>

          {purpose !== 'recovery' ? (
            <View style={styles.changeRow}>
              <Text style={styles.resendMuted}>
                Wrong email?{' '}
                <Text style={styles.resendLink} onPress={onCancel}>
                  Change it
                </Text>
              </Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  root: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  closeBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    padding: 4,
  },
  closePlaceholder: {
    height: 38,
    marginTop: 8,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginTop: 24,
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 12,
  },
  emailLine: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
    textAlign: 'center',
    marginTop: 4,
  },
  explain: {
    fontSize: 13,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  otpWrap: {
    marginTop: 32,
    width: '100%',
    alignItems: 'center',
  },
  verifyBtn: {
    marginTop: 24,
  },
  resendRow: {
    marginTop: 16,
    alignItems: 'center',
  },
  resendMuted: {
    fontSize: 13,
    color: '#5A6A8A',
    textAlign: 'center',
  },
  resendLink: {
    color: '#0047AB',
    fontWeight: '500',
  },
  changeRow: {
    marginTop: 12,
  },
})
