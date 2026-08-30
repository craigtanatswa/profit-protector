import React, { useEffect, useRef, useState } from 'react'
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

// ─── Step definitions ─────────────────────────────────────────────────────────

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
    icon: 'storefront-outline',
    iconBackground: '#E6EEFF',
    iconColor: '#0047AB',
    title: 'Welcome to your inventory!',
    body: "Your inventory is the foundation of your business. Every sale, stock alert, and profit calculation starts here. Let's take 60 seconds to show you how to add your first product.",
    tip: 'You can always add more products later from the inventory screen.',
  },
  {
    icon: 'cube-outline',
    iconBackground: '#E6EEFF',
    iconColor: '#0047AB',
    title: 'Name, Category & Unit',
    body: 'Give your product a clear, specific name — for example "Coca-Cola 500ml" instead of just "Coke". Add a category to group similar items together. Choose the unit you sell in, such as Each, kg, litre or box.',
    tip: 'Good names make it faster to find products when recording a sale.',
  },
  {
    icon: 'calculator-outline',
    iconBackground: '#E6F4EE',
    iconColor: '#0A7A4B',
    title: 'Cost Price & Selling Price',
    body: 'Cost price is what you paid for the product. Selling price is what you charge your customers. As you type, Profit Protector shows your profit margin live — so you always know you are not selling at a loss.',
    tip: 'Even a small margin difference adds up across hundreds of sales.',
  },
  {
    icon: 'layers-outline',
    iconBackground: '#FEF3E2',
    iconColor: '#B45309',
    title: 'Opening Stock & Low Stock Alert',
    body: 'Enter how many units you currently have on hand. Set a low stock threshold so Profit Protector alerts you before you run out — for example, alert me when fewer than 5 remain.',
    tip: 'You can adjust stock at any time from the inventory screen.',
  },
]

// ─── Step indicator dots ───────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === current ? styles.dotActive : styles.dotInactive,
          ]}
        />
      ))}
    </View>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddProductTutorialModalProps {
  visible: boolean
  ownerName?: string
  onComplete: () => void
  onDismiss: () => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AddProductTutorialModal({
  visible,
  ownerName,
  onComplete,
  onDismiss,
}: AddProductTutorialModalProps) {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState(0)
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current
  const isLast = step === STEPS.length - 1
  const bottomInset = Math.max(insets.bottom, 12)

  useEffect(() => {
    if (!visible) return
    setStep(0)
    fadeAnim.setValue(1)
    slideAnim.setValue(0)
  }, [visible, fadeAnim, slideAnim])

  const animateToStep = (next: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -24,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStep(next)
      slideAnim.setValue(24)
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
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

  const handleSkip = () => {
    onDismiss()
  }

  const current = STEPS[step]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleSkip}
      statusBarTranslucent
    >
      <View style={[styles.overlay, { paddingBottom: bottomInset }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleSkip} />

        <View style={styles.sheet}>
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View>
                <Text style={styles.headerEyebrow}>
                  {step === 0 ? `Hi${ownerName ? `, ${ownerName}` : ''}!` : `Step ${step} of ${STEPS.length - 1}`}
                </Text>
                <Text style={styles.headerTitle}>Quick Start Guide</Text>
              </View>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>
            <StepDots total={STEPS.length} current={step} />
          </View>

          {/* ── Body ── */}
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
              {/* Icon badge / logo on welcome step */}
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

          {/* ── Footer buttons ── */}
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
                {isLast ? "Let's Add My First Product" : 'Next'}
              </Text>
              <Ionicons
                name={isLast ? 'cube-outline' : 'arrow-forward'}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  // ── Header
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

  // ── Body
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

  // ── Footer
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
