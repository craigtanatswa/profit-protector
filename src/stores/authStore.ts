import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { refreshOwnerProductsFromSupabase, syncAll, syncInventoryFast } from '../lib/sync'
import { fetchBusinessRowForUser, businessInfoFromRemoteRow } from '../lib/businessRemote'
import { ensureLocalWatermelonForSession, businessInfoFromLocalWatermelon } from '../lib/ensureLocalWatermelon'
import {
  clearOwnerSessionLogin,
  enforceOwnerSessionMaxAge,
} from '../lib/sessionPersistence'
import type { SyncStatus } from '../lib/sync'
import type { DeviceApprovalRequest, ShopkeeperSession, UserRole } from '../types'

/** When Realtime fires during an owner sync, run another sync afterward so sales/stock always reconcile. */
let ownerSyncQueued = false

export interface BusinessInfo {
  id: string
  name: string
  ownerName: string
  phone: string
  businessType: string
  currency: string
  /** ZiG per 1 USD — used when currency is ZiG or Both (amounts in DB stay USD cents). */
  zigRatePerUsd: number
  /** Normalized login username when set; otherwise sign-in uses phone. */
  loginUsername?: string | null
  recoveryEmail?: string
  recoveryEmailVerified: boolean
  publicId?: string
}

interface AuthState {
  user: User | null
  business: BusinessInfo | null
  isLoading: boolean
  isAuthenticated: boolean
  isFirstLaunch: boolean
  activeRole: UserRole
  shopkeeperSession: ShopkeeperSession | null
  pendingApprovalRequests: DeviceApprovalRequest[]

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
  setActiveRole: (role: UserRole) => void
  setShopkeeperSession: (session: ShopkeeperSession | null) => void
  setPendingApprovalRequests: (requests: DeviceApprovalRequest[]) => void
  clearShopkeeperSession: () => void
  logout: () => Promise<void>
  initializeAuth: () => Promise<void>

  // Sync actions
  setSyncStatus: (status: SyncStatus) => void
  setLastSyncedAt: (timestamp: number) => void
  setSyncError: (error: string | null) => void
  setSyncStats: (pushed: number, pulled: number) => void
  triggerSync: (businessId: string) => Promise<void>
  /** Fast path: push+pull only products and stock_movements in background after an inventory write. */
  triggerInventorySync: (businessId: string) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  business: null,
  isLoading: true,
  isAuthenticated: false,
  isFirstLaunch: true,
  activeRole: 'owner',
  shopkeeperSession: null,
  pendingApprovalRequests: [],

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

  setActiveRole: (activeRole) =>
    set({ activeRole }),

  setShopkeeperSession: (shopkeeperSession) =>
    set({ shopkeeperSession, activeRole: shopkeeperSession ? 'shopkeeper' : 'owner' }),

  setPendingApprovalRequests: (pendingApprovalRequests) =>
    set({ pendingApprovalRequests }),

  clearShopkeeperSession: () =>
    set({ activeRole: 'owner', shopkeeperSession: null, pendingApprovalRequests: [] }),

  logout: async () => {
    try {
      const { removeOwnerExpoPushTokensFromSupabase } = await import('../lib/expoPushRemote')
      await removeOwnerExpoPushTokensFromSupabase()
    } catch {
      /* push cleanup is best-effort */
    }
    try {
      await supabase.auth.signOut()
    } catch {
      /* session may already be invalid after server-side user deletion */
    }
    await clearOwnerSessionLogin()
    set({
      user: null,
      business: null,
      isAuthenticated: false,
      syncStatus: 'idle',
      lastSyncedAt: null,
      syncError: null,
      recordsPushed: 0,
      recordsPulled: 0,
      activeRole: 'owner',
      shopkeeperSession: null,
      pendingApprovalRequests: [],
    })
  },

  initializeAuth: async () => {
    set({ isLoading: true })
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const sessionValid = await enforceOwnerSessionMaxAge(session)
      if (sessionValid && session?.user) {
        set({ user: session.user, isAuthenticated: true })
        const { data: biz, error: bizErr } = await fetchBusinessRowForUser(session.user.id)
        if (!bizErr && biz) {
          set({ business: businessInfoFromRemoteRow(biz), activeRole: 'owner', shopkeeperSession: null })
          await ensureLocalWatermelonForSession(session.user, biz)
          await refreshOwnerProductsFromSupabase(biz.id).catch(() => {})
          await get().triggerSync(biz.id).catch(() => {})
        } else {
          const localBiz = await businessInfoFromLocalWatermelon(session.user.id)
          set({ business: localBiz, activeRole: 'owner', shopkeeperSession: null })
          if (localBiz?.id) {
            await refreshOwnerProductsFromSupabase(localBiz.id).catch(() => {})
            await get().triggerSync(localBiz.id).catch(() => {})
          }
        }
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
    if (get().activeRole !== 'owner') return

    if (get().syncStatus === 'syncing') {
      ownerSyncQueued = true
      return
    }

    ownerSyncQueued = false
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
    } finally {
      if (ownerSyncQueued && get().activeRole === 'owner') {
        ownerSyncQueued = false
        await get().triggerSync(businessId)
      }
    }
  },

  triggerInventorySync: (businessId: string) => {
    if (get().activeRole !== 'owner') return
    // Fire-and-forget: write already happened locally; push+pull products and movements
    // to Supabase so the cloud is updated quickly without blocking the full sync queue.
    syncInventoryFast(businessId).catch(() => {})
    // Also schedule a full sync so the rest of the tables reconcile in the background.
    get().triggerSync(businessId).catch(() => {})
  },
}))
