import { Stack } from 'expo-router'

export default function SalesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0047AB' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Sales', headerShown: false }} />
      <Stack.Screen name="new" options={{ title: 'New Sale', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Sale Detail', headerShown: false }} />
    </Stack>
  )
}
