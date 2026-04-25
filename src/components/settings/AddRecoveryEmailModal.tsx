import React, { useEffect, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { z } from 'zod'

import { Button, Card, Input } from '../ui'
import { EmailVerificationModal } from '../auth/EmailVerificationModal'
import { sendEmailOTP } from '../../lib/emailOTP'
import { isMissingRecoveryColumnsError } from '../../lib/businessRemote'
import { supabase } from '../../lib/supabase'
import { database } from '../../database'
import type Business from '../../database/models/Business'
import type { BusinessInfo } from '../../stores/authStore'

const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')

export interface AddRecoveryEmailModalProps {
  visible: boolean
  onClose: () => void
  business: BusinessInfo
  userId: string
  setBusiness: (b: BusinessInfo) => void
}

export function AddRecoveryEmailModal({
  visible,
  onClose,
  business,
  userId,
  setBusiness,
}: AddRecoveryEmailModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [sending, setSending] = useState(false)
  const [verifyVisible, setVerifyVisible] = useState(false)

  useEffect(() => {
    if (!visible) return
    setStep(1)
    setError(undefined)
    setSending(false)
    setVerifyVisible(false)
    setEmail(business.recoveryEmail?.trim() ?? '')
  }, [visible, business.recoveryEmail])

  const title = business.recoveryEmail ? 'Update Email' : 'Add Recovery Email'

  async function handleSendCode() {
    const parsed = emailSchema.safeParse(email.trim())
    if (!parsed.success) {
      setError(parsed.error.flatten().formErrors[0] ?? 'Invalid email')
      return
    }
    setError(undefined)
    setSending(true)
    const result = await sendEmailOTP(parsed.data, 'add_email')
    setSending(false)
    if (!result.success) {
      Alert.alert('Could not send code', result.error ?? 'Please try again.')
      return
    }
    setVerifyVisible(true)
    setStep(2)
  }

  async function handleVerified() {
    const trimmed = email.trim()
    setVerifyVisible(false)

    if (!database) {
      Alert.alert('Error', 'Local database not available.')
      return
    }

    try {
      const { error: remoteErr } = await supabase
        .from('businesses')
        .update({
          recovery_email: trimmed,
          recovery_email_verified: true,
        })
        .eq('id', business.id)

      if (remoteErr) {
        if (isMissingRecoveryColumnsError(remoteErr)) {
          Alert.alert(
            'Database update needed',
            'Add the recovery email columns in Supabase (SQL is described at the top of the Settings source file), then try again.',
          )
        } else {
          Alert.alert('Error', remoteErr.message)
        }
        return
      }

      const records = await database.get<Business>('businesses').query().fetch()
      const localRecord = records.find((r) => r.supabaseId === userId) ?? records[0]
      if (localRecord) {
        await database.write(async () => {
          await localRecord.update((b) => {
            b.recoveryEmail = trimmed
            b.recoveryEmailVerified = true
          })
        })
      }

      setBusiness({
        ...business,
        recoveryEmail: trimmed,
        recoveryEmailVerified: true,
      })

      onClose()
      Alert.alert(
        'Success',
        'Email verified and saved! Your account is now protected.',
      )
    } catch {
      Alert.alert('Error', 'Could not save email. Please try again.')
    }
  }

  function handleVerifyCancel() {
    setVerifyVisible(false)
    setStep(1)
  }

  return (
    <>
      <Modal visible={visible && !verifyVisible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeWrap}>
              <Ionicons name="close" size={26} color="#5A6A8A" />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <Card padding="md" style={styles.explainCard}>
              <View style={styles.explainRow}>
                <Ionicons name="shield-checkmark" size={20} color="#0047AB" />
                <Text style={styles.explainText}>
                  Your email adds security to your account. It is used to verify your identity when
                  changing your password and to recover your account if you lose access.
                </Text>
              </View>
            </Card>

            <Input
              label="Email Address"
              placeholder="your@email.com"
              value={email}
              onChangeText={(t) => {
                setEmail(t)
                setError(undefined)
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={error}
              leftIcon={<Ionicons name="mail-outline" size={18} color="#5A6A8A" />}
              editable={!sending}
            />

            <View style={styles.btn}>
              <Button
                label={sending ? 'Sending...' : 'Send Verification Code'}
                onPress={handleSendCode}
                variant="primary"
                size="lg"
                fullWidth
                loading={sending}
                disabled={sending}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <EmailVerificationModal
        visible={verifyVisible}
        email={email.trim()}
        purpose="add_email"
        onSuccess={handleVerified}
        onCancel={handleVerifyCancel}
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
  explainCard: {
    marginBottom: 20,
    backgroundColor: '#E6EEFF',
    borderColor: '#0047AB',
    borderWidth: 1,
  },
  explainRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  explainText: {
    flex: 1,
    fontSize: 13,
    color: '#0047AB',
    lineHeight: 20,
  },
  btn: {
    marginTop: 24,
  },
})
