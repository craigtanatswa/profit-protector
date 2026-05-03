import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Keep Register mounted when opening Terms / Privacy so onboarding step and form state persist.
        // @ts-expect-error detachInactiveScreens is supported at runtime but missing from current Expo Router stack types
        detachInactiveScreens: false,
      }}
    />
  )
}
