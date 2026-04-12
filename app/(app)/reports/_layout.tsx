import { Stack } from 'expo-router'

export default function ReportsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#1A202C',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Reports' }} />
    </Stack>
  )
}
