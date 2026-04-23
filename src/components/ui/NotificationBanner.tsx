import React, { useEffect, useRef } from 'react'
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

export interface NotificationBannerProps {
  visible: boolean
  title: string
  message: string
  type: 'warning' | 'danger'
  productId?: string | null
  onPress: () => void
  onDismiss: () => void
}

export function NotificationBanner({
  visible,
  title,
  message,
  type,
  onPress,
  onDismiss,
}: NotificationBannerProps) {
  const insets = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(-120)).current

  const isWarning = type === 'warning'
  const iconName = isWarning ? 'warning' : 'alert-circle'
  const accentColor = isWarning ? '#B45309' : '#C0152A'
  const bgColor = isWarning ? '#FFF8F0' : '#FCEBEB'
  const borderColor = isWarning ? '#B45309' : '#C0152A'

  function showBanner() {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 14,
      bounciness: 4,
    }).start()
  }

  function hideBanner() {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 250,
      useNativeDriver: true,
    }).start(() => onDismiss())
  }

  useEffect(() => {
    if (visible) {
      showBanner()
      const timer = setTimeout(() => {
        hideBanner()
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8, transform: [{ translateY: slideAnim }] },
        { backgroundColor: bgColor, borderColor },
      ]}
    >
      <TouchableOpacity
        style={styles.inner}
        activeOpacity={0.85}
        onPress={() => {
          hideBanner()
          onPress()
        }}
      >
        {/* Icon */}
        <View style={[styles.iconCircle, { backgroundColor: bgColor }]}>
          <Ionicons name={iconName} size={20} color={accentColor} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={[styles.title, { color: accentColor }]}>{title}</Text>
          <Text style={styles.message} numberOfLines={2}>
            {message}
          </Text>
        </View>

        {/* Dismiss */}
        <TouchableOpacity
          style={styles.dismissBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={hideBanner}
        >
          <Ionicons name="close" size={18} color="#5A6A8A" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 16,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    marginLeft: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  message: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  dismissBtn: {
    padding: 4,
  },
})
