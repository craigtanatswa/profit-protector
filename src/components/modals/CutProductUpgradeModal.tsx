import React from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../ui'
import { formatPlanPrice } from '../../lib/plans'

export interface CutProductUpgradeModalProps {
  visible: boolean
  /** Amount charged today for a mid-cycle Pro → Pro+ upgrade, in cents. */
  upgradeChargeCents?: number | null
  upgradeIsFree?: boolean
  onClose: () => void
  onUpgrade: () => void
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function CutProductUpgradeModal({
  visible,
  upgradeChargeCents,
  upgradeIsFree = false,
  onClose,
  onUpgrade,
}: CutProductUpgradeModalProps) {
  const monthly = formatPlanPrice('pro_plus')
  const hasTodayAmount =
    upgradeIsFree || (upgradeChargeCents != null && Number.isFinite(upgradeChargeCents))

  const amountLine = upgradeIsFree
    ? `You can upgrade at no charge today, then ${monthly} / month.`
    : hasTodayAmount
      ? `You can upgrade for ${formatCents(upgradeChargeCents ?? 0)} today, then ${monthly} / month.`
      : `You can upgrade for ${monthly} / month.`

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <View style={styles.overlay} />
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cut-outline" size={32} color="#7C3AED" />
          </View>
          <Text style={styles.title}>Not available on Pro</Text>
          <Text style={styles.body}>
            Cut from a piece is not available on the Pro plan. {amountLine} Record leftover
            meat, cloth, and similar items sold in varying sizes.
          </Text>
          <View style={styles.actions}>
            <Button label="Upgrade to Pro+" onPress={onUpgrade} variant="primary" fullWidth />
            <Button label="Not now" onPress={onClose} variant="ghost" fullWidth />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 27, 62, 0.45)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 16,
    zIndex: 1,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F3EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 10,
  },
  actions: {
    marginTop: 20,
    gap: 4,
  },
})
