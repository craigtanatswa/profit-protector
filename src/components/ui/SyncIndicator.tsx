import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../stores/authStore'

// ---------------------------------------------------------------------------
// Time-ago helper
// ---------------------------------------------------------------------------

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return 'over a day ago'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SyncIndicatorProps {
  style?: ViewStyle
}

export function SyncIndicator({ style }: SyncIndicatorProps) {
  const syncStatus = useAuthStore((s) => s.syncStatus)
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt)

  const spinAnim = useRef(new Animated.Value(0)).current
  const loopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (syncStatus === 'syncing') {
      spinAnim.setValue(0)
      loopRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      )
      loopRef.current.start()
    } else {
      loopRef.current?.stop()
      loopRef.current = null
      spinAnim.setValue(0)
    }

    return () => {
      loopRef.current?.stop()
    }
  }, [syncStatus])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  if (syncStatus === 'idle' && !lastSyncedAt) {
    return null
  }

  if (syncStatus === 'syncing') {
    return (
      <View style={[styles.row, style]}>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name="sync" size={14} color="#0047AB" />
        </Animated.View>
        <Text style={styles.syncingText}>Syncing...</Text>
      </View>
    )
  }

  if (syncStatus === 'error') {
    return (
      <View style={[styles.row, style]}>
        <Ionicons name="warning" size={14} color="#B45309" />
        <Text style={styles.errorText}>Sync failed</Text>
      </View>
    )
  }

  if (syncStatus === 'success' && lastSyncedAt) {
    return (
      <View style={[styles.row, style]}>
        <Ionicons name="checkmark-circle" size={14} color="#0A7A4B" />
        <Text style={styles.successText}>Synced {timeAgo(lastSyncedAt)}</Text>
      </View>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncingText: {
    fontSize: 11,
    color: '#5A6A8A',
  },
  successText: {
    fontSize: 11,
    color: '#5A6A8A',
  },
  errorText: {
    fontSize: 11,
    color: '#B45309',
  },
})
