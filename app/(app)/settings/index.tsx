import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '../../../src/components/ui'
import { useAuthStore } from '../../../src/stores/authStore'

export default function SettingsScreen() {
  const router = useRouter()
  const logout = useAuthStore((s) => s.logout)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
      router.replace('/(auth)/login')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>More options coming soon</Text>

      <View style={styles.footer}>
        <Button
          label="Log out"
          onPress={handleLogout}
          variant="danger"
          size="lg"
          fullWidth
          loading={loggingOut}
          disabled={loggingOut}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 18,
    color: '#1A202C',
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#718096',
    marginTop: 8,
  },
  footer: {
    marginTop: 'auto',
    paddingBottom: 32,
  },
})
