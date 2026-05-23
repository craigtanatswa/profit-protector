import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { BrandLogo } from '../layout/BrandLogo'

interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.15,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start()
  }, [pulse])

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <BrandLogo variant="mark" color="white" width={120} height={120} />
      </Animated.View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0047AB',
  },
  message: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 32,
  },
})
