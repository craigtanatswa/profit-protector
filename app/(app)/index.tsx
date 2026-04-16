import { StyleSheet, Text, View } from 'react-native'

import { BrandLogo } from '../../src/components/layout'

export default function DashboardScreen() {
  // TODO: Replace with real content
  return (
    <View style={styles.container}>
      <BrandLogo variant="full" width={88} height={88} style={styles.logo} />
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FA',
  },
  logo: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    color: '#1A202C',
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 14,
    color: '#718096',
    marginTop: 8,
  },
})
