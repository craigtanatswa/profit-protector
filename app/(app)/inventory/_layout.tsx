import { Stack } from 'expo-router'

export default function InventoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#1A202C',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Inventory' }} />
      <Stack.Screen name="add" options={{ title: 'Add Product' }} />
    </Stack>
  )
}
