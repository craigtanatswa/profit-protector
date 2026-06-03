import React, { useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'

import { sendSupportMessage } from '../../lib/supportMessage'
import { ModalSheet } from '../settings/ModalSheet'

type SupportMessageModalProps = {
  visible: boolean
  onClose: () => void
}

export function SupportMessageModal({ visible, onClose }: SupportMessageModalProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleClose = () => {
    if (sending) return
    setMessage('')
    setError(null)
    setSent(false)
    onClose()
  }

  const handleSend = async () => {
    setError(null)
    setSending(true)
    const result = await sendSupportMessage(message)
    setSending(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSent(true)
    setMessage('')
  }

  return (
    <ModalSheet
      visible={visible}
      onClose={handleClose}
      title="Send us a message"
      avoidKeyboard
    >
      {sent ? (
        <>
          <Text style={styles.successText}>
            Thank you — your message was sent. We will get back to you as soon as we can.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleClose}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Describe your question or issue. We will reply using the contact details on your account.
          </Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Type your message here…"
            placeholderTextColor="#A0AEC0"
            multiline
            textAlignVertical="top"
            maxLength={4000}
            editable={!sending}
          />
          <Text style={styles.charCount}>{message.length}/4000</Text>
          {error != null && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.primaryButton, sending && styles.primaryButtonDisabled]}
            onPress={handleSend}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Send message</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleClose} disabled={sending}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 14,
    color: '#5A6A8A',
    lineHeight: 20,
    marginBottom: 16,
  },
  input: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0D1B3E',
    backgroundColor: '#F8F9FA',
  },
  charCount: {
    fontSize: 12,
    color: '#A0AEC0',
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#C53030',
    marginBottom: 12,
  },
  successText: {
    fontSize: 15,
    color: '#0D1B3E',
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#0047AB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#5A6A8A',
    fontSize: 15,
    fontWeight: '500',
  },
})
