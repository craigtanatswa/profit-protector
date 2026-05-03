import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useRef } from 'react'
import {
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card } from '../../src/components/ui'
import { logActivity } from '../../src/lib/activityLogger'
import { checkApprovalStatus, resumeShopkeeperAfterApproval } from '../../src/lib/shopkeeperAuth'
import { getDeviceName } from '../../src/lib/deviceId'
import type { BusinessInfo } from '../../src/stores/authStore'
import { useAuthStore } from '../../src/stores/authStore'

function Dot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 400,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ]),
      ).start()
    }, delay)

    return () => clearTimeout(timer)
  }, [delay, opacity])

  return <Animated.View style={[styles.dot, { opacity }]} />
}

export default function ShopkeeperPendingScreen() {
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const setShopkeeperSession = useAuthStore((s) => s.setShopkeeperSession)

  const { businessId, username, deviceId } = useLocalSearchParams<{
    businessId: string
    username: string
    deviceId: string
    message?: string
  }>()
  const [deviceName, setDeviceName] = React.useState('Android Device')

  useEffect(() => {
    getDeviceName().then(setDeviceName).catch(() => {})
  }, [])

  const completingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pollRef: ReturnType<typeof setInterval> | undefined

    const runCheck = async () => {
      const biz = String(businessId ?? '')
      const user = String(username ?? '')
      const dev = String(deviceId ?? '')
      if (!biz || !user || !dev) return

      const status = await checkApprovalStatus({
        businessId: biz,
        username: user,
        deviceId: dev,
      })
      if (cancelled) return

      if (status === 'approved') {
        if (completingRef.current) return
        completingRef.current = true
        try {
          const result = await resumeShopkeeperAfterApproval({
            businessId: biz,
            username: user,
            deviceId: dev,
          })
          if (cancelled) return

          if (result.status === 'approved' && result.session) {
            if (pollRef) clearInterval(pollRef)
            const info: BusinessInfo = {
              id: result.session.businessId,
              name: result.session.businessName,
              ownerName: result.session.shopkeeper.fullName,
              phone: '',
              businessType: '',
              currency: 'USD',
              zigRatePerUsd: 1,
              recoveryEmailVerified: false,
            }
            setUser(null)
            setBusiness(info)
            setShopkeeperSession(result.session)
            await logActivity({ action: 'account_login_shopkeeper', entityType: 'account' })
            router.replace('/(app)')
            return
          }

          Alert.alert(
            'Almost there',
            result.message ??
              'Could not finish signing you in yet. We will keep checking, or go back and sign in again.',
            [{ text: 'OK' }],
          )
        } finally {
          completingRef.current = false
        }
        return
      }

      if (status === 'denied') {
        if (pollRef) clearInterval(pollRef)
        Alert.alert(
          'Access Denied',
          'The business owner has denied this login request. Please contact them for assistance.',
          [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
        )
      }
    }

    void runCheck()
    pollRef = setInterval(() => {
      void runCheck()
    }, 10000)

    return () => {
      cancelled = true
      if (pollRef) clearInterval(pollRef)
    }
  }, [
    businessId,
    deviceId,
    router,
    username,
    setUser,
    setBusiness,
    setShopkeeperSession,
  ])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="time-outline" size={40} color="#B45309" />
        </View>
        <Text style={styles.title}>Waiting for Approval</Text>
        <Text style={styles.subtitle}>
          Your login request has been sent to the business owner. When they approve this device,
          you will be signed in automatically.
        </Text>

        <View style={styles.dots}>
          <Dot delay={0} />
          <Dot delay={400} />
          <Dot delay={800} />
        </View>

        <Card padding="md" style={styles.statusCard}>
          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={18} color="#5A6A8A" />
            <Text style={styles.infoLabel}>Business ID:</Text>
            <Text style={styles.infoValue}>{businessId}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={18} color="#5A6A8A" />
            <Text style={styles.infoLabel}>Username:</Text>
            <Text style={styles.infoValue}>{username}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="phone-portrait-outline" size={18} color="#5A6A8A" />
            <Text style={styles.infoLabel}>Device:</Text>
            <Text style={styles.infoValue}>{deviceName}</Text>
          </View>
        </Card>

        <View style={styles.cancel}>
          <Button
            label="Cancel request"
            variant="ghost"
            size="md"
            onPress={() => {
              Alert.alert('Cancel login request?', 'You can sign in again later.', [
                { text: 'Keep waiting', style: 'cancel' },
                { text: 'Cancel request', onPress: () => router.replace('/(auth)/login') },
              ])
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  content: { flex: 1, alignItems: 'center', padding: 24 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FAEEDA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: '#0D1B3E',
    textAlign: 'center',
    marginTop: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 8,
  },
  dots: { flexDirection: 'row', gap: 8, marginTop: 28 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#B45309' },
  statusCard: { alignSelf: 'stretch', marginTop: 32 },
  infoRow: { flexDirection: 'row', alignItems: 'center', minHeight: 34 },
  infoLabel: { marginLeft: 8, fontSize: 13, color: '#5A6A8A' },
  infoValue: { marginLeft: 6, flex: 1, fontSize: 13, color: '#0D1B3E', fontWeight: '500' },
  cancel: { alignSelf: 'stretch', marginTop: 24 },
})
