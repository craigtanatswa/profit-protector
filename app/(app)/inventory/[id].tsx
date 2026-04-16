import { Stack, useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Product Detail' }} />
      <Text style={styles.title}>Product Detail</Text>
      <Text style={styles.subtitle}>ID: {id}</Text>
      <Text style={styles.hint}>Coming in Step 12</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F6FB',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  subtitle: {
    fontSize: 14,
    color: '#5A6A8A',
    marginTop: 8,
  },
  hint: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 16,
  },
})
