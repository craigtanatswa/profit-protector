import { useRouter } from 'expo-router'

import { PrivacyPolicyView } from '../../../src/components/legal/PrivacyPolicyView'

export default function AppPrivacyPolicyScreen() {
  const router = useRouter()
  return <PrivacyPolicyView onBack={() => router.back()} />
}
