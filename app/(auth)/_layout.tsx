import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Keep Register mounted when opening Terms / Privacy so onboarding step and form state persist.
        detachInactiveScreens: false,
      }}
    />
  )
}
