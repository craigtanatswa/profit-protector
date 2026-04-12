import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface BusinessInfo {
  id: string
  name: string
  ownerName: string
  phone: string
  businessType: string
  currency: string
  /** Normalized login username when set; otherwise sign-in uses phone. */
  loginUsername?: string | null
}

interface AuthState {
  user: User | null
  business: BusinessInfo | null
  isLoading: boolean
  isAuthenticated: boolean
  isFirstLaunch: boolean
  syncStatus: 'idle' | 'syncing' | 'error'
  setUser: (user: User | null) => void
  setBusiness: (business: BusinessInfo | null) => void
  setLoading: (loading: boolean) => void
  setFirstLaunch: (bool: boolean) => void
  setSyncStatus: (status: 'idle' | 'syncing' | 'error') => void
  logout: () => Promise<void>
  initializeAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  business: null,
  isLoading: true,
  isAuthenticated: false,
  isFirstLaunch: true,
  syncStatus: 'idle',

  setUser: (user) =>
    set({ user, isAuthenticated: user !== null }),

  setBusiness: (business) =>
    set({ business }),

  setLoading: (isLoading) =>
    set({ isLoading }),

  setFirstLaunch: (isFirstLaunch) =>
    set({ isFirstLaunch }),

  setSyncStatus: (syncStatus) =>
    set({ syncStatus }),

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, business: null, isAuthenticated: false })
  },

  initializeAuth: async () => {
    set({ isLoading: true })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        set({ user: session.user, isAuthenticated: true })
      } else {
        set({ user: null, business: null, isAuthenticated: false })
      }
    } catch {
      set({ user: null, business: null, isAuthenticated: false })
    } finally {
      set({ isLoading: false })
    }
  },
}))
