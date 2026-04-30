import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native'

interface AnimatedRowProps {
  children: React.ReactNode
  delay?: number
  direction?: 'up' | 'left'
  style?: StyleProp<ViewStyle>
}

export function AnimatedRow({
  children,
  delay = 0,
  direction = 'up',
  style,
}: AnimatedRowProps) {
  const opacity = useRef(new Animated.Value(0)).current
  const translate = useRef(new Animated.Value(direction === 'up' ? 20 : 30)).current

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start()
    }, delay)
    return () => clearTimeout(t)
  }, [delay, opacity, translate])

  const transform =
    direction === 'up'
      ? [{ translateY: translate }]
      : [{ translateX: translate }]

  return (
    <Animated.View style={[styles.wrap, { opacity, transform }, style]}>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {},
})
