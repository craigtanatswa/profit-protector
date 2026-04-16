import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { BrandLogo } from '../layout/BrandLogo'

interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <BrandLogo variant="full" width={100} height={100} style={styles.logo} />
      <ActivityIndicator size="large" color="#FFFFFF" />
      <Text style={styles.message}>{message}</Text>
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
  logo: {
    marginBottom: 28,
  },
  message: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 16,
  },
})
