import { useRouter } from 'expo-router'

import { TermsOfServiceView } from '../../src/components/legal/TermsOfServiceView'

export default function AuthTermsOfServiceScreen() {
  const router = useRouter()
  return <TermsOfServiceView onBack={() => router.back()} />
}
