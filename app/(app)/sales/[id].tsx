import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ScreenHeader } from '../../../src/components/layout'
import { useRouter } from 'expo-router'

export default function SaleDetailScreen() {
  const router = useRouter()
  const { id, showReceipt } = useLocalSearchParams<{ id: string; showReceipt?: string }>()

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Sale Receipt"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        showBorder
      />
      <View style={styles.content}>
        <Text style={styles.receiptIcon}>✓</Text>
        <Text style={styles.title}>Sale Complete!</Text>
        <Text style={styles.subtitle}>
          Receipt and sale details will appear here.
        </Text>
        <Text style={styles.saleId}>Sale ID: {id}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  receiptIcon: {
    fontSize: 48,
    color: '#0A7A4B',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#5A6A8A',
    textAlign: 'center',
  },
  saleId: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 16,
    fontFamily: 'monospace',
  },
})
