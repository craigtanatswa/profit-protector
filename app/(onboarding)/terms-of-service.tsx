import { useRouter } from 'expo-router'

import { TermsOfServiceView } from '../../src/components/legal/TermsOfServiceView'

/** Same content as auth Terms — stays on onboarding stack so back returns to convert. */
export default function OnboardingTermsOfServiceScreen() {
  const router = useRouter()
  return <TermsOfServiceView onBack={() => router.back()} />
}
