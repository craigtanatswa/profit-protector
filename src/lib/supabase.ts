import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

export const SUPABASE_URL = 'https://hanlkrkdajptbykjykvf.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhbmxrcmtkYWpwdGJ5a2p5a3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTc2MjAsImV4cCI6MjA5MTQzMzYyMH0.NYerSmiFSjoT8iHu5ednRQ5fry1NwxzvWXzebnWrUMc'

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
