import React, { useEffect, useRef } from 'react'
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Badge } from '../ui'
import { formatCurrency } from '../../lib/formatters'
import type { Customer } from '../../types'

// ---------------------------------------------------------------------------
// Avatar color helpers
// ---------------------------------------------------------------------------

function getAvatarColors(name: string): { bg: string; text: string } {
  const code = name.charAt(0).toUpperCase().charCodeAt(0) - 65 // A=0, Z=25
  if (code <= 4) return { bg: '#E6EEFF', text: '#0047AB' }  // A-E
  if (code <= 9) return { bg: '#EAF3DE', text: '#0A7A4B' }  // F-J
  if (code <= 14) return { bg: '#FAEEDA', text: '#854F0B' } // K-O
  if (code <= 19) return { bg: '#FCEBEB', text: '#A32D2D' } // P-T
  return { bg: '#F0EEFF', text: '#4A3AA5' }                 // U-Z
}

// ---------------------------------------------------------------------------
// HighlightWrapper — fades from #E6EEFF to white when isHighlighted flips true
// ---------------------------------------------------------------------------

interface HighlightWrapperProps {
  isHighlighted: boolean
  children: React.ReactNode
}

export function HighlightWrapper({ isHighlighted, children }: HighlightWrapperProps) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (isHighlighted) {
      anim.setValue(1)
      Animated.timing(anim, {
        toValue: 0,
        duration: 1500,
        useNativeDriver: false,
      }).start()
    }
  }, [isHighlighted, anim])

  const bgColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FFFFFF', '#E6EEFF'],
  })

  return (
    <Animated.View style={[styles.highlightWrapper, { backgroundColor: bgColor }]}>
      {children}
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// CustomerCard
// ---------------------------------------------------------------------------

interface CustomerCardProps {
  customer: Customer
  onPress: () => void
}

export function CustomerCard({ customer, onPress }: CustomerCardProps) {
  const { bg, text } = getAvatarColors(customer.name)
  const initials = customer.name.slice(0, 2).toUpperCase()
  const isOwing = customer.outstandingBalanceCents > 0

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      style={[styles.card, isOwing && styles.owingBorder]}
    >
      <View style={styles.row}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: bg }]}>
          <Text style={[styles.avatarText, { color: text }]}>{initials}</Text>
        </View>

        {/* Customer info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {customer.name}
          </Text>
          {customer.phone ? (
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={12} color="#5A6A8A" />
              <Text style={styles.phone}>{customer.phone}</Text>
            </View>
          ) : (
            <Text style={styles.noPhone}>No phone number</Text>
          )}
        </View>

        {/* Right side */}
        <View style={styles.right}>
          {isOwing ? (
            <>
              <Text style={styles.amount}>
                {formatCurrency(customer.outstandingBalanceCents)}
              </Text>
              <Text style={styles.outstandingLabel}>outstanding</Text>
            </>
          ) : (
            <Badge label="Settled" variant="success" size="sm" />
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  highlightWrapper: {
    borderRadius: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 12,
    padding: 16,
  },
  owingBorder: {
    borderLeftWidth: 3,
    borderLeftColor: '#C0152A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  phone: {
    fontSize: 12,
    color: '#5A6A8A',
    marginLeft: 3,
  },
  noPhone: {
    fontSize: 12,
    color: '#DDE3F0',
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#C0152A',
  },
  outstandingLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    textAlign: 'right',
    marginTop: 1,
  },
})
