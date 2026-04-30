import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../../src/components/ui'
import { AnimatedRow } from '../../src/components/onboarding/AnimatedRow'
import { OnboardingScreenLayout } from '../../src/components/onboarding/OnboardingScreenLayout'

export default function TrustScreen() {
  const router = useRouter()

  return (
    <OnboardingScreenLayout
      screenIndex={7}
      showSkip
      footer={
        <Button
          variant="primary"
          label="I am ready to start"
          onPress={() => router.push('/(onboarding)/convert')}
          size="lg"
          fullWidth
        />
      }
    >
      <Text style={styles.title}>Your data is safe — always</Text>
      <Text style={styles.subtitle}>Three things business owners always ask us:</Text>

      <AnimatedRow delay={0}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={[styles.iconBox, styles.iconNeutral]}>
            <Ionicons name="wifi-outline" size={22} color="#5A6A8A" />
          </View>
          <View style={styles.rowTxt}>
            <Text style={styles.rowTitle}>What if I have no internet?</Text>
            <Text style={styles.rowBody}>
              The app works completely offline. All your sales and stock are saved on your phone first. No WiFi or mobile data needed.
            </Text>
          </View>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={250}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={[styles.iconBox, styles.iconBlue]}>
            <Ionicons name="cloud-outline" size={22} color="#0047AB" />
          </View>
          <View style={styles.rowTxt}>
            <Text style={styles.rowTitle}>What if my phone is lost or stolen?</Text>
            <Text style={styles.rowBody}>
              Your data is automatically backed up to the cloud. Log in on any new phone and everything comes back — every sale, every product, every customer.
            </Text>
          </View>
        </View>
      </AnimatedRow>

      <AnimatedRow delay={500}>
        <View style={styles.row}>
          <View style={[styles.iconBox, styles.iconGreen]}>
            <Ionicons name="school-outline" size={22} color="#3B6D11" />
          </View>
          <View style={styles.rowTxt}>
            <Text style={styles.rowTitle}>Do I need to know accounting?</Text>
            <Text style={styles.rowBody}>
              No. If you know how to sell, you know how to use Profit Protector. It is designed for business owners, not accountants.
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
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    marginBottom: 24,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconNeutral: {
    backgroundColor: '#F4F6FB',
  },
  iconBlue: {
    backgroundColor: '#E6EEFF',
  },
  iconGreen: {
    backgroundColor: '#EAF3DE',
  },
  rowTxt: {
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
    marginTop: 6,
  },
})
