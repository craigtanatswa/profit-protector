import React from 'react'
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { OnboardingProgress } from './OnboardingProgress'

const BG = '#F4F6FB'

interface OnboardingScreenLayoutProps {
  screenIndex: number
  children: React.ReactNode
  footer: React.ReactNode
  showSkip?: boolean
}

export function OnboardingScreenLayout({
  screenIndex,
  children,
  footer,
  showSkip = false,
}: OnboardingScreenLayoutProps) {
  const router = useRouter()

  const onSkip = () => {
    Alert.alert(
      'Skip introduction?',
      'You can explore these features once you are logged in.',
      [
        { text: 'Continue tour', style: 'cancel' },
        {
          text: 'Skip to sign up',
          onPress: () => router.replace('/(auth)/register?fromOnboarding=1'),
        },
      ],
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      {showSkip && (
        <TouchableOpacity style={styles.skipBtn} onPress={onSkip} hitSlop={12}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <OnboardingProgress total={9} current={screenIndex} />
        <View style={styles.flex}>{children}</View>
        {footer}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  skipBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
  },
  skipText: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
  },
  flex: {
    flex: 1,
  },
})
