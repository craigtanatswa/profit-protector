import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { StockAccessType } from '../../types'
import { stockAccessPendingMessage, stockAccessTypeLabel } from '../../lib/stockAccessLabels'

interface StockAccessPendingModalProps {
  visible: boolean
  accessType: StockAccessType
  shopkeeperName: string
  onCancel: () => void
}

function PulsingDot({ delay }: { delay: number }) {
  const scale = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(scale, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.4,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [delay, scale])

  return (
    <Animated.View style={[styles.dot, { transform: [{ scale }] }]} />
  )
}

export function StockAccessPendingModal({
  visible,
  accessType,
  shopkeeperName,
  onCancel,
}: StockAccessPendingModalProps) {
  const actionLabel = stockAccessTypeLabel(accessType)
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <View style={styles.overlay} />
        <View style={styles.card}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="cube-outline" size={36} color="#0047AB" />
          </View>

          {/* Title */}
          <Text style={styles.title}>Waiting for {actionLabel} Approval</Text>

          {/* Message */}
          <Text style={styles.body}>{stockAccessPendingMessage(accessType)}</Text>

          {/* Pulsing dots */}
          <View style={styles.dotsRow}>
            <PulsingDot delay={0} />
            <PulsingDot delay={200} />
            <PulsingDot delay={400} />
          </View>

          {/* Info pill */}
          <View style={styles.infoPill}>
            <Ionicons name="time-outline" size={14} color="#0047AB" />
            <Text style={styles.infoText}>
              {actionLabel} access valid for 24 hours once approved
            </Text>
          </View>

          {/* Staff name */}
          {shopkeeperName.length > 0 ? (
            <Text style={styles.staffHint}>
              Requesting as{' '}
              <Text style={styles.staffName}>{shopkeeperName}</Text>
            </Text>
          ) : null}

          {/* Cancel */}
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.75}>
            <Text style={styles.cancelText}>Cancel Request</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0047AB',
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF3FF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 12,
    color: '#0047AB',
    fontWeight: '500',
  },
  staffHint: {
    fontSize: 13,
    color: '#5A6A8A',
    marginBottom: 24,
    textAlign: 'center',
  },
  staffName: {
    fontWeight: '600',
    color: '#0D1B3E',
  },
  cancelButton: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#DDE3F0',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5A6A8A',
  },
})
