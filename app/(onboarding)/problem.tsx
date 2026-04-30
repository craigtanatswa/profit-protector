import React from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../../src/components/ui'
import { AnimatedRow } from '../../src/components/onboarding/AnimatedRow'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'

export default function ProblemScreen() {
  const router = useRouter()

  const advance = () => router.push('/(onboarding)/personalise')

  const onGhost = () => {
    Alert.alert('', 'Great — keep it that way with a good system')
    setTimeout(advance, 800)
  }

  return (
    <OnboardingScreenLayout
      screenIndex={1}
      showSkip
      footer={
        <>
          <Button variant="primary" label="I want to fix this" onPress={advance} size="lg" fullWidth />
          <TouchableOpacity style={styles.ghostWrap} onPress={onGhost}>
            <Text style={styles.ghost}>This doesn&apos;t apply to me</Text>
          </TouchableOpacity>
        </>
      }
    >
      <Text style={styles.title}>Running a business from memory is risky</Text>
      <Text style={styles.subtitle}>Three things happen when you have no system:</Text>

      <AnimatedRow delay={0}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={[styles.iconBox, styles.iconRedBg]}>
            <Ionicons name="cube-outline" size={22} color="#C0152A" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Stock goes missing and you don&apos;t notice</Text>
            <Text style={styles.rowBody}>
              Theft, damage, or expired goods quietly reduce your money without any record
            </Text>
          </View>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={200}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={[styles.iconBox, styles.iconAmberBg]}>
            <Ionicons name="cash-outline" size={22} color="#B45309" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Customers owe you — and forget</Text>
            <Text style={styles.rowBody}>
              Credit sales in a notebook get disputed, lost, or simply never collected
            </Text>
          </View>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={400}>
        <View style={styles.row}>
          <View style={[styles.iconBox, styles.iconRedBg]}>
            <Ionicons name="bar-chart-outline" size={22} color="#C0152A" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>You don&apos;t know if you&apos;re actually profitable</Text>
            <Text style={styles.rowBody}>
              Sales feel good but costs, stock losses, and debts eat the real profit
            </Text>
          </View>
        </View>
      </AnimatedRow>
    </OnboardingScreenLayout>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: '#0D1B3E',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRedBg: {
    backgroundColor: '#FCEBEB',
  },
  iconAmberBg: {
    backgroundColor: '#FAEEDA',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  rowBody: {
    fontSize: 13,
    color: '#5A6A8A',
    lineHeight: 13 * 1.6,
    marginTop: 4,
  },
  ghostWrap: {
    marginTop: 16,
    alignItems: 'center',
  },
  ghost: {
    fontSize: 14,
    color: '#718096',
    textAlign: 'center',
  },
})
