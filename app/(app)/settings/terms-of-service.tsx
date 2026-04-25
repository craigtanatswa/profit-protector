import { useRouter } from 'expo-router'

import { TermsOfServiceView } from '../../../src/components/legal/TermsOfServiceView'

export default function AppTermsOfServiceScreen() {
  const router = useRouter()
  return <TermsOfServiceView onBack={() => router.back()} />
}
