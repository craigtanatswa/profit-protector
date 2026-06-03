import { useRouter } from 'expo-router'

import { HelpSupportView } from '../../../src/components/support/HelpSupportView'

export default function HelpSupportScreen() {
  const router = useRouter()
  return <HelpSupportView onBack={() => router.back()} />
}
