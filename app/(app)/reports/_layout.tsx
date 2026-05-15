import { Redirect, Stack } from 'expo-router'

import { useAuthStore } from '../../../src/stores/authStore'

export default function ReportsLayout() {
  const activeRole = useAuthStore((s) => s.activeRole)
  if (activeRole === 'shopkeeper') {
    return <Redirect href="/(app)" />
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0047AB' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Reports', headerShown: false }} />
    </Stack>
  )
}
