import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { syncAll } from '../lib/sync'
import type { SyncStatus } from '../lib/sync'

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

  // Sync state
  syncStatus: SyncStatus
  lastSyncedAt: number | null
  syncError: string | null
  recordsPushed: number
  recordsPulled: number

  // Auth actions
  setUser: (user: User | null) => void
  setBusiness: (business: BusinessInfo | null) => void
  setLoading: (loading: boolean) => void
  setFirstLaunch: (bool: boolean) => void
  logout: () => Promise<void>
  initializeAuth: () => Promise<void>

  // Sync actions
  setSyncStatus: (status: SyncStatus) => void
  setLastSyncedAt: (timestamp: number) => void
  setSyncError: (error: string | null) => void
  setSyncStats: (pushed: number, pulled: number) => void
  triggerSync: (businessId: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  business: null,
  isLoading: true,
  isAuthenticated: false,
  isFirstLaunch: true,

  syncStatus: 'idle',
  lastSyncedAt: null,
  syncError: null,
  recordsPushed: 0,
  recordsPulled: 0,

  // ---- Auth actions ----

  setUser: (user) =>
    set({ user, isAuthenticated: user !== null }),

  setBusiness: (business) =>
    set({ business }),

  setLoading: (isLoading) =>
    set({ isLoading }),

  setFirstLaunch: (isFirstLaunch) =>
    set({ isFirstLaunch }),

  logout: async () => {
    await supabase.auth.signOut()
    set({
      user: null,
      business: null,
      isAuthenticated: false,
      syncStatus: 'idle',
      lastSyncedAt: null,
      syncError: null,
      recordsPushed: 0,
      recordsPulled: 0,
    })
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

  // ---- Sync actions ----

  setSyncStatus: (syncStatus) =>
    set({ syncStatus }),

  setLastSyncedAt: (lastSyncedAt) =>
    set({ lastSyncedAt }),

  setSyncError: (syncError) =>
    set({ syncError }),

  setSyncStats: (recordsPushed, recordsPulled) =>
    set({ recordsPushed, recordsPulled }),

  triggerSync: async (businessId: string) => {
    if (get().syncStatus === 'syncing') return

    set({ syncStatus: 'syncing', syncError: null })

    try {
      const result = await syncAll(businessId)
      set({ syncStatus: result.status })
      if (result.lastSyncedAt) {
        set({ lastSyncedAt: result.lastSyncedAt })
      }
      set({ recordsPushed: result.recordsPushed, recordsPulled: result.recordsPulled })
      if (result.errors.length > 0) {
        set({ syncError: result.errors.join(', ') })
      }
    } catch (err) {
      set({
        syncStatus: 'error',
        syncError: err instanceof Error ? err.message : 'Sync failed',
      })
    }
  },
}))
