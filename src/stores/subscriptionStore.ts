import { create } from 'zustand'
import type { Subscription } from '../types'

interface SubscriptionStore {
  subscription: Subscription | null
  isLoading: boolean
  /** True once the first fetch attempt has completed (success or error). */
  hasFetched: boolean

  setSubscription(s: Subscription | null): void
  setLoading(loading: boolean): void
  setHasFetched(v: boolean): void
}

export const useSubscriptionStore = create<SubscriptionStore>((set) => ({
  subscription: null,
  isLoading: false,
  hasFetched: false,

  setSubscription: (subscription) => set({ subscription }),
  setLoading: (isLoading) => set({ isLoading }),
  setHasFetched: (hasFetched) => set({ hasFetched }),
}))
