import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { Button, Input } from '../ui'
import { EmailVerificationModal } from '../auth/EmailVerificationModal'
import { sendEmailOTP } from '../../lib/emailOTP'
import { supabase } from '../../lib/supabase'
import {
  buildLegacySupabaseEmailFromPhone,
  buildSupabaseEmailFromPhone,
} from '../../lib/authIdentity'
import type { BusinessInfo } from '../../stores/authStore'

function PasswordStepIndicator({
  labels,
  currentStep,
}: {
  labels: string[]
  currentStep: number
}) {
  return (
    <View style={pi.row}>
      {labels.map((label, index) => {
        const stepNum = index + 1
        const completed = stepNum < currentStep
        const active = stepNum === currentStep
        const highlight = completed || active
        return (
          <React.Fragment key={label}>
            <View style={pi.step}>
              <View
                style={[
                  pi.dot,
                  highlight ? pi.dotActive : pi.dotIdle,
                ]}
              >
                {completed ? (
                  <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                ) : null}
              </View>
              <Text
                style={[
                  pi.label,
                  highlight ? pi.labelActive : pi.labelIdle,
                ]}
                numberOfLines={2}
              >
                {label}
              </Text>
            </View>
            {index < labels.length - 1 ? <View style={pi.line} /> : null}
          </React.Fragment>
        )
      })}
    </View>
  )
}

const pi = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  step: {
    alignItems: 'center',
    width: 72,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  dotActive: {
    backgroundColor: '#0047AB',
  },
  dotIdle: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#DDE3F0',
  },
  label: {
    fontSize: 10,
    textAlign: 'center',
  },
  labelActive: {
    color: '#0047AB',
    fontWeight: '600',
  },
  labelIdle: {
    color: '#5A6A8A',
  },
  line: {
    flex: 1,
    height: 2,
    backgroundColor: '#DDE3F0',
    marginTop: 4,
  },
})

export interface ChangePasswordModalProps {
  visible: boolean
  onClose: () => void
  business: BusinessInfo
}

export function ChangePasswordModal({ visible, onClose, business }: ChangePasswordModalProps) {
  const [step, setStep] = useState(1)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [otpVisible, setOtpVisible] = useState(false)
  const [otpPrimed, setOtpPrimed] = useState(false)
  const currentPasswordRef = useRef('')

  const [errors, setErrors] = useState<{
    currentPassword?: string
    newPassword?: string
    confirmPassword?: string
  }>({})

  const needsEmailOtp =
    Boolean(business.recoveryEmail?.trim()) && business.recoveryEmailVerified === true

  const stepLabels = needsEmailOtp
    ? (['Verify identity', 'Email code', 'New password'] as const)
    : (['Verify identity', 'New password'] as const)

  const indicatorStep =
    needsEmailOtp ? step : step === 3 ? 2 : step

  useEffect(() => {
    if (!visible) return
    setStep(1)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrors({})
    setShowCurrent(false)
    setShowNew(false)
    setShowConfirm(false)
    setSaving(false)
    setOtpVisible(false)
    setOtpPrimed(false)
    currentPasswordRef.current = ''
  }, [visible])

  useEffect(() => {
    if (!otpVisible || !needsEmailOtp || otpPrimed || !business.recoveryEmail) return
    let cancelled = false
    ;(async () => {
      const result = await sendEmailOTP(business.recoveryEmail!, 'change_password')
      if (cancelled) return
      if (!result.success) {
        Alert.alert('Could not send code', result.error ?? 'Please try again.')
        setOtpVisible(false)
        setStep(needsEmailOtp ? 2 : 3)
        return
      }
      setOtpPrimed(true)
    })()
    return () => {
      cancelled = true
    }
  }, [otpVisible, otpPrimed, needsEmailOtp, business.recoveryEmail])

  const validateNewPasswords = (): boolean => {
    const errs: typeof errors = {}
    if (!newPassword || newPassword.length < 6) {
      errs.newPassword = 'New password must be at least 6 characters'
    }
    if (newPassword !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const validateCurrent = (): boolean => {
    const errs: typeof errors = {}
    if (!currentPassword) {
      errs.currentPassword = 'Current password is required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function reauthPhoneSession(): Promise<boolean> {
    const primaryEmail = buildSupabaseEmailFromPhone(business.phone)
    const legacyEmail = buildLegacySupabaseEmailFromPhone(business.phone)
    const trySign = (email: string) =>
      supabase.auth.signInWithPassword({ email, password: currentPasswordRef.current })

    let { error } = await trySign(primaryEmail)
    if (error) {
      const second = await trySign(legacyEmail)
      error = second.error
    }
    return !error
  }

  async function handleStep1Continue() {
    if (!validateCurrent()) return
    setSaving(true)
    try {
      const primaryEmail = buildSupabaseEmailFromPhone(business.phone)
      const legacyEmail = buildLegacySupabaseEmailFromPhone(business.phone)

      const trySignIn = (email: string) =>
        supabase.auth.signInWithPassword({ email, password: currentPassword })

      let { error: authError } = await trySignIn(primaryEmail)
      let reauthed = !authError
      if (!reauthed) {
        const { error: legacyError } = await trySignIn(legacyEmail)
        reauthed = !legacyError
      }

      if (!reauthed) {
        setErrors({ currentPassword: 'Current password is incorrect' })
        setSaving(false)
        return
      }

      currentPasswordRef.current = currentPassword

      if (needsEmailOtp) {
        setOtpPrimed(false)
        setOtpVisible(true)
        setStep(2)
      } else {
        setStep(3)
      }
    } catch {
      Alert.alert('Error', 'Could not verify password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleOtpSuccess() {
    setOtpVisible(false)
    const ok = await reauthPhoneSession()
    if (!ok) {
      Alert.alert('Session error', 'Please try again from the beginning.')
      onClose()
      return
    }
    setStep(3)
  }

  function handleOtpCancel() {
    setOtpVisible(false)
    onClose()
  }

  async function handleSaveNewPassword() {
    if (!validateNewPasswords()) return
    setSaving(true)
    try {
      const ok = await reauthPhoneSession()
      if (!ok) {
        Alert.alert('Session expired', 'Please open Change Password again.')
        setSaving(false)
        onClose()
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) {
        Alert.alert('Error', updateError.message)
        setSaving(false)
        return
      }

      Alert.alert('Success', 'Password updated successfully.')
      onClose()
    } catch {
      Alert.alert('Error', 'Could not update password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal visible={visible && !otpVisible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Change Password</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeWrap}>
              <Ionicons name="close" size={26} color="#5A6A8A" />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <PasswordStepIndicator labels={[...stepLabels]} currentStep={indicatorStep} />

            {step === 1 ? (
              <>
                <Input
                  label="Current Password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry={!showCurrent}
                  error={errors.currentPassword}
                  editable={!saving}
                  rightIcon={
                    <TouchableOpacity onPress={() => setShowCurrent((v) => !v)}>
                      <Ionicons
                        name={showCurrent ? 'eye-off-outline' : 'eye-outline'}
                        size={18}
                        color="#718096"
                      />
                    </TouchableOpacity>
                  }
                />
                <View style={styles.btn}>
                  <Button
                    label={saving ? 'Checking...' : 'Continue'}
                    onPress={handleStep1Continue}
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={saving}
                    disabled={saving}
                  />
                </View>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Input
                  label="New Password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNew}
                  error={errors.newPassword}
                  editable={!saving}
                  rightIcon={
                    <TouchableOpacity onPress={() => setShowNew((v) => !v)}>
                      <Ionicons
                        name={showNew ? 'eye-off-outline' : 'eye-outline'}
                        size={18}
                        color="#718096"
                      />
                    </TouchableOpacity>
                  }
                />
                <Input
                  label="Confirm New Password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirm}
                  error={errors.confirmPassword}
                  editable={!saving}
                  rightIcon={
                    <TouchableOpacity onPress={() => setShowConfirm((v) => !v)}>
                      <Ionicons
                        name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                        size={18}
                        color="#718096"
                      />
                    </TouchableOpacity>
                  }
                />
                <View style={styles.btn}>
                  <Button
                    label={saving ? 'Updating...' : 'Update Password'}
                    onPress={handleSaveNewPassword}
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={saving}
                    disabled={saving}
                  />
                </View>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <EmailVerificationModal
        visible={otpVisible}
        email={business.recoveryEmail?.trim() ?? ''}
        purpose="change_password"
        explanatoryText="For your security, we sent a verification code to your recovery email before allowing a password change."
        onSuccess={handleOtpSuccess}
        onCancel={handleOtpCancel}
      />
    </>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#DDE3F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  closeWrap: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
  scroll: {
    padding: 24,
    paddingBottom: 40,
  },
  btn: {
    marginTop: 24,
  },
})
