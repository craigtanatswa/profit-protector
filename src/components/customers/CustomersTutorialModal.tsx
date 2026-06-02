import React, { useRef, useState } from 'react'
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BrandLogo } from '../layout/BrandLogo'

interface TutorialStep {
  icon: React.ComponentProps<typeof Ionicons>['name']
  iconBackground: string
  iconColor: string
  title: string
  body: string
  tip?: string
}

const STEPS: TutorialStep[] = [
  {
    icon: 'people-outline',
    iconBackground: '#E6EEFF',
    iconColor: '#0047AB',
    title: 'Welcome to Customers!',
    body: "Keep track of everyone who buys on credit. See who owes you money, record payments when they pay, and stay on top of outstanding balances — all in one place.",
    tip: 'You only need customers for credit sales — cash sales do not require a customer profile.',
  },
  {
    icon: 'person-add-outline',
    iconBackground: '#E6EEFF',
    iconColor: '#0047AB',
    title: 'Add Your Customers',
    body: 'Tap the + button to add a customer with their name and optional phone number. You can add customers before or during a credit sale.',
    tip: 'Use the customer\'s full name so they are easy to find when recording a sale.',
  },
  {
    icon: 'receipt-outline',
    iconBackground: '#E6F4EE',
    iconColor: '#0A7A4B',
    title: 'Record Credit Sales',
    body: 'When recording a sale, choose Credit as the payment method and select the customer. Their balance updates automatically and appears on this screen.',
    tip: 'Credit sales also show on your dashboard under Credit Owed.',
  },
  {
    icon: 'cash-outline',
    iconBackground: '#FEF3E2',
    iconColor: '#B45309',
    title: 'Collect Payments & Filter',
    body: 'Tap a customer to view their history and record a payment when they settle up. Use the All, Owing, and Settled tabs to quickly see who still owes you.',
    tip: 'The summary bar at the top shows total customers and how much is still owed.',
  },
]

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === current ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  )
}

interface CustomersTutorialModalProps {
  visible: boolean
  ownerName?: string
  onComplete: () => void
  onDismiss: () => void
}

export function CustomersTutorialModal({
  visible,
  ownerName,
  onComplete,
  onDismiss,
}: CustomersTutorialModalProps) {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState(0)
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current
  const isLast = step === STEPS.length - 1
  const bottomInset = Math.max(insets.bottom, 12)

  const animateToStep = (next: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -24, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setStep(next)
      slideAnim.setValue(24)
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start()
    })
  }

  const handleNext = () => {
    if (isLast) {
      onComplete()
    } else {
      animateToStep(step + 1)
    }
  }

  const handleBack = () => {
    if (step > 0) animateToStep(step - 1)
  }

  const current = STEPS[step]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={[styles.overlay, { paddingBottom: bottomInset }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss} />

        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View>
                <Text style={styles.headerEyebrow}>
                  {step === 0
                    ? `Hi${ownerName ? `, ${ownerName}` : ''}!`
                    : `Step ${step} of ${STEPS.length - 1}`}
                </Text>
                <Text style={styles.headerTitle}>Customers Quick Start</Text>
              </View>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={onDismiss}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>
            <StepDots total={STEPS.length} current={step} />
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View
              style={[
                styles.bodyContent,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
              ]}
            >
              {step === 0 ? (
                <View style={styles.logoBadge}>
                  <BrandLogo variant="mark" color="blue" width={56} height={56} />
                </View>
              ) : (
                <View style={[styles.iconBadge, { backgroundColor: current.iconBackground }]}>
                  <Ionicons name={current.icon} size={36} color={current.iconColor} />
                </View>
              )}

              <Text style={styles.stepTitle}>{current.title}</Text>
              <Text style={styles.stepBody}>{current.body}</Text>

              {current.tip != null ? (
                <View style={styles.tipRow}>
                  <Ionicons name="bulb-outline" size={16} color="#0047AB" style={styles.tipIcon} />
                  <Text style={styles.tipText}>{current.tip}</Text>
                </View>
              ) : null}
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            {step > 0 ? (
              <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={16} color="#5A6A8A" />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backPlaceholder} />
            )}

            <TouchableOpacity
              style={[styles.nextBtn, isLast && styles.nextBtnLast]}
              onPress={handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.nextText}>
                {isLast ? "Let's Add My First Customer" : 'Next'}
              </Text>
              <Ionicons
                name={isLast ? 'person-add-outline' : 'arrow-forward'}
                size={16}
                color="#FFFFFF"
                style={styles.nextIcon}
              />
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
    maxHeight: '88%',
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
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  skipBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  skipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    height: 4,
    borderRadius: 2,
  },
  dotActive: {
    width: 20,
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  body: {
    paddingBottom: 8,
  },
  bodyContent: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
    alignItems: 'center',
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F0F4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
  },
  stepBody: {
    fontSize: 15,
    color: '#3D4F6E',
    textAlign: 'center',
    lineHeight: 23,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F4FF',
    borderRadius: 10,
    padding: 12,
    marginTop: 20,
    width: '100%',
  },
  tipIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#0047AB',
    lineHeight: 19,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F8',
    gap: 12,
  },
  backPlaceholder: {
    width: 80,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 4,
    minWidth: 80,
  },
  backText: {
    fontSize: 14,
    color: '#5A6A8A',
    fontWeight: '500',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0047AB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flex: 1,
    gap: 6,
  },
  nextBtnLast: {
    backgroundColor: '#0A7A4B',
  },
  nextText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  nextIcon: {
    marginLeft: 2,
  },
})
