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
import { checkApprovalStatus } from '../../src/lib/shopkeeperAuth'
import { getDeviceName } from '../../src/lib/deviceId'

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

  useEffect(() => {
    const poll = setInterval(async () => {
      const status = await checkApprovalStatus({
        businessId: String(businessId ?? ''),
        username: String(username ?? ''),
        deviceId: String(deviceId ?? ''),
      })

      if (status === 'approved') {
        clearInterval(poll)
        Alert.alert(
          'Access Approved!',
          'The owner has approved your device. Please sign in again.',
          [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login') }],
        )
      }

      if (status === 'denied') {
        clearInterval(poll)
        Alert.alert(
          'Access Denied',
          'The business owner has denied this login request. Please contact them for assistance.',
          [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
        )
      }
    }, 10000)

    return () => clearInterval(poll)
  }, [businessId, deviceId, router, username])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="time-outline" size={40} color="#B45309" />
        </View>
        <Text style={styles.title}>Waiting for Approval</Text>
        <Text style={styles.subtitle}>
          Your login request has been sent to the business owner. This page will update
          automatically when they respond.
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
