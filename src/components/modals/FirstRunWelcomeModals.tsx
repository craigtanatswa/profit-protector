import React from 'react'
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BrandLogo } from '../layout/BrandLogo'

interface TrialWelcomeModalProps {
  visible: boolean
  ownerName?: string
  daysRemainingInTrial: number
  onGetStarted: () => void
}

export function TrialWelcomeModal({
  visible,
  ownerName,
  daysRemainingInTrial,
  onGetStarted,
}: TrialWelcomeModalProps) {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 12)

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onGetStarted}
      statusBarTranslucent
    >
      <View style={[styles.overlay, { paddingBottom: bottomInset }]}>
        <View style={styles.backdrop} />

        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerEyebrow}>
              {ownerName ? `Hi, ${ownerName}!` : 'Welcome!'}
            </Text>
            <Text style={styles.headerTitle}>Welcome to Profit Protector</Text>
          </View>

          <View style={styles.body}>
            <View style={styles.logoWrap}>
              <BrandLogo variant="mark" color="blue" width={72} height={72} />
            </View>

            <Text style={styles.title}>You're all set to get started</Text>
            <Text style={styles.bodyText}>
              You have a {daysRemainingInTrial}-day free trial — no payment needed yet.
              Explore all features and start protecting your business profits today.
            </Text>

            <View style={styles.trialBadge}>
              <Ionicons name="time-outline" size={16} color="#0047AB" />
              <Text style={styles.trialBadgeText}>
                {daysRemainingInTrial} days of full access
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onGetStarted}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Get Started</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

interface GoToInventoryPromptModalProps {
  visible: boolean
  onGoToInventory: () => void
  onLater: () => void
}

export function GoToInventoryPromptModal({
  visible,
  onGoToInventory,
  onLater,
}: GoToInventoryPromptModalProps) {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 12)

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onLater}
      statusBarTranslucent
    >
      <View style={[styles.overlay, { paddingBottom: bottomInset }]}>
        <View style={styles.backdrop} />

        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerEyebrow}>Your first step</Text>
            <Text style={styles.headerTitle}>Set up your inventory</Text>
          </View>

          <View style={styles.body}>
            <View style={[styles.iconBadge, { backgroundColor: '#E6EEFF' }]}>
              <Ionicons name="cube-outline" size={36} color="#0047AB" />
            </View>

            <Text style={styles.title}>Head to Stock & Products</Text>
            <Text style={styles.bodyText}>
              Open the Stock & Products tab to add your first product. Once your
              inventory is set up, you can record sales and track profit right away.
            </Text>

            <View style={styles.stepHint}>
              <View style={styles.stepHintIcon}>
                <Ionicons name="arrow-down" size={18} color="#0047AB" />
              </View>
              <Text style={styles.stepHintText}>
                Tap the Stock tab at the bottom of your screen
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onGoToInventory}
              activeOpacity={0.85}
            >
              <Ionicons name="cube-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Go to Stock & Products</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onLater}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryBtnText}>I'll do it later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  header: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerEyebrow: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 8,
    alignItems: 'center',
  },
  logoWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F0F4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
  },
  bodyText: {
    fontSize: 15,
    color: '#3D4F6E',
    textAlign: 'center',
    lineHeight: 23,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F4FF',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 20,
  },
  trialBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0047AB',
  },
  stepHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 10,
    padding: 12,
    marginTop: 20,
    width: '100%',
  },
  stepHintIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stepHintText: {
    flex: 1,
    fontSize: 13,
    color: '#0047AB',
    lineHeight: 19,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F8',
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0047AB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontSize: 14,
    color: '#5A6A8A',
    fontWeight: '500',
  },
})
