import { useRouter } from 'expo-router'

import { PrivacyPolicyView } from '../../src/components/legal/PrivacyPolicyView'

/** Same content as auth Privacy — stays on onboarding stack so back returns to convert. */
export default function OnboardingPrivacyPolicyScreen() {
  const router = useRouter()
  return <PrivacyPolicyView onBack={() => router.back()} />
}
