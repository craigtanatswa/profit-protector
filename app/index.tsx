import { Redirect } from 'expo-router'

/** Default entry: auth login (Expo Router otherwise prefers the (app) group first). */
export default function RootIndex() {
  return <Redirect href="/(auth)/login" />
}
