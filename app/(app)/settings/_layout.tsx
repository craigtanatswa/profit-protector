import { Stack } from 'expo-router'

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0047AB' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings', headerShown: false }} />
      <Stack.Screen
        name="manage-staff"
        options={{ title: 'Manage Staff', headerShown: false }}
      />
      <Stack.Screen
        name="activity-log"
        options={{ title: 'Activity Log', headerShown: false }}
      />
      <Stack.Screen
        name="help-support"
        options={{ title: 'Help & Support', headerShown: false }}
      />
      <Stack.Screen
        name="privacy-policy"
        options={{ title: 'Privacy Policy', headerShown: false }}
      />
      <Stack.Screen
        name="terms-of-service"
        options={{ title: 'Terms of Service', headerShown: false }}
      />
      <Stack.Screen name="payments" options={{ title: 'Payment History', headerShown: false }} />
      <Stack.Screen name="upgrade-plan" options={{ title: 'Upgrade Plan', headerShown: false, presentation: 'modal' }} />
    </Stack>
  )
}
