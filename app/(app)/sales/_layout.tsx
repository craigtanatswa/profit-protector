import { Stack } from 'expo-router'

export default function SalesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0047AB',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Sales', headerShown: false }} />
      <Stack.Screen name="new" options={{ title: 'New Sale', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Sale Detail', headerShown: false }} />
    </Stack>
  )
}
