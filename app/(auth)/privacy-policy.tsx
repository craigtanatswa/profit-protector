import { useRouter } from 'expo-router'

import { PrivacyPolicyView } from '../../src/components/legal/PrivacyPolicyView'

export default function AuthPrivacyPolicyScreen() {
  const router = useRouter()
  return <PrivacyPolicyView onBack={() => router.back()} />
}
