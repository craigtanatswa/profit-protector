import { Stack } from 'expo-router'

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0047AB',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen
        name="privacy-policy"
        options={{ title: 'Privacy Policy', headerShown: false }}
      />
      <Stack.Screen
        name="terms-of-service"
        options={{ title: 'Terms of Service', headerShown: false }}
      />
    </Stack>
  )
}
