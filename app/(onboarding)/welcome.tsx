import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { Button } from '../../src/components/ui'
import { OnboardingProgress } from '../../src/components/onboarding/OnboardingProgress'

export default function WelcomeScreen() {
  const router = useRouter()
  const anim = useRef(new Animated.Value(0)).current
  const [displayDollars, setDisplayDollars] = useState(0)

  useEffect(() => {
    const id = anim.addListener(({ value }) => {
      setDisplayDollars(Math.round(value))
    })
    Animated.timing(anim, {
      toValue: 420,
      duration: 1500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
    return () => {
      anim.removeListener(id)
    }
  }, [anim])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.scrollInner}>
        <OnboardingProgress total={9} current={0} />

        <View style={styles.header}>
          <Text style={styles.appName}>Profit Protector</Text>
          <Text style={styles.tagline}>A smarter way to run your business</Text>
        </View>

        <View style={styles.cardsRow}>
          <View style={styles.cardBad}>
            <Text style={styles.cardBadLabel}>Without a system</Text>
            <Text style={styles.cardBadValue}>$0</Text>
            <Text style={styles.cardBadSub}>Profit unknown</Text>
          </View>
          <View style={styles.cardGood}>
            <Text style={styles.cardGoodLabel}>With Profit Protector</Text>
            <Text style={styles.cardGoodValue}>${displayDollars}</Text>
            <Text style={styles.cardGoodSub}>Today&apos;s profit</Text>
          </View>
        </View>

        <Text style={styles.body}>
          Most business owners in Zimbabwe cannot tell you their exact profit today. This app changes that.
        </Text>

        <View style={styles.flex} />

        <Button
          variant="primary"
          label="Show me how it works"
          onPress={() => router.push('/(onboarding)/problem')}
          size="lg"
          fullWidth
        />

        <TouchableOpacity
          style={styles.secondaryWrap}
          onPress={() => router.replace('/(auth)/login')}
          hitSlop={12}
        >
          <Text style={styles.secondary}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  scrollInner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 32,
  },
  appName: {
    fontSize: 28,
    fontWeight: '500',
    color: '#0047AB',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 6,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  cardBad: {
    flex: 1,
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#E24B4A',
    borderRadius: 12,
    padding: 16,
  },
  cardBadLabel: {
    fontSize: 12,
    color: '#A32D2D',
    marginBottom: 8,
  },
  cardBadValue: {
    fontSize: 28,
    fontWeight: '500',
    color: '#A32D2D',
  },
  cardBadSub: {
    fontSize: 12,
    color: '#A32D2D',
    opacity: 0.8,
    marginTop: 4,
  },
  cardGood: {
    flex: 1,
    backgroundColor: '#E6EEFF',
    borderWidth: 1,
    borderColor: '#0047AB',
    borderRadius: 12,
    padding: 16,
  },
  cardGoodLabel: {
    fontSize: 12,
    color: '#0047AB',
    marginBottom: 8,
  },
  cardGoodValue: {
    fontSize: 28,
    fontWeight: '500',
    color: '#0047AB',
  },
  cardGoodSub: {
    fontSize: 12,
    color: '#0047AB',
    opacity: 0.8,
    marginTop: 4,
  },
  body: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    lineHeight: 14 * 1.7,
    marginBottom: 32,
  },
  flex: {
    flex: 1,
    minHeight: 8,
  },
  secondaryWrap: {
    marginTop: 16,
    alignItems: 'center',
  },
  secondary: {
    fontSize: 13,
    color: '#0047AB',
    textAlign: 'center',
  },
})
