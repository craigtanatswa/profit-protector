import { Stack } from 'expo-router'

export default function InventoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0047AB' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Inventory' }} />
      <Stack.Screen name="add" options={{ title: 'Add Product' }} />
    </Stack>
  )
}
