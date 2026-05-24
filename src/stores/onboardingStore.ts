import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'

const ONBOARDING_COMPLETED_KEY = 'onboarding_completed'

export type BusinessType =
  | 'tuck_shop'
  | 'hardware'
  | 'tech_shop'
  | 'salon'
  | 'clothing'
  | 'pharmacy'
  | 'restaurant'
  | 'other'

export type TrackingMethod = 'notebook' | 'whatsapp' | 'excel' | 'none'

export type MainChallenge = 'profit' | 'stock' | 'debts' | 'all'

export interface OnboardingState {
  businessType: BusinessType | null
  trackingMethod: TrackingMethod | null
  mainChallenge: MainChallenge | null
  businessName: string
  ownerName: string
  /** Set on convert screen before navigating to verify-phone; cleared after signup. */
  signupPhone: string
  signupPassword: string
  hasCompletedOnboarding: boolean
  hydrated: boolean

  setBusinessType: (type: BusinessType) => void
  setTrackingMethod: (method: TrackingMethod) => void
  setMainChallenge: (challenge: MainChallenge) => void
  setBusinessName: (name: string) => void
  setOwnerName: (name: string) => void
  setSignupCredentials: (phone: string, password: string) => void
  clearSignupCredentials: () => void
  completeOnboarding: () => Promise<void>
  resetOnboarding: () => void
  hydrateFromStorage: () => Promise<void>
  /** Edge case: user registered elsewhere but SecureStore still shows incomplete */
  markCompletedSyncedWithAuth: () => Promise<void>
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  businessType: null,
  trackingMethod: null,
  mainChallenge: null,
  businessName: '',
  ownerName: '',
  signupPhone: '',
  signupPassword: '',
  hasCompletedOnboarding: false,
  hydrated: false,

  setBusinessType: (type) => set({ businessType: type }),
  setTrackingMethod: (method) => set({ trackingMethod: method }),
  setMainChallenge: (challenge) => set({ mainChallenge: challenge }),
  setBusinessName: (name) => set({ businessName: name }),
  setOwnerName: (name) => set({ ownerName: name }),

  setSignupCredentials: (phone, password) =>
    set({ signupPhone: phone, signupPassword: password }),

  clearSignupCredentials: () => set({ signupPhone: '', signupPassword: '' }),

  completeOnboarding: async () => {
    await SecureStore.setItemAsync(ONBOARDING_COMPLETED_KEY, 'true')
    set({ hasCompletedOnboarding: true })
  },

  resetOnboarding: () =>
    set({
      businessType: null,
      trackingMethod: null,
      mainChallenge: null,
      businessName: '',
      ownerName: '',
      signupPhone: '',
      signupPassword: '',
    }),

  hydrateFromStorage: async () => {
    try {
      const v = await SecureStore.getItemAsync(ONBOARDING_COMPLETED_KEY)
      set({ hasCompletedOnboarding: v === 'true', hydrated: true })
    } catch {
      set({ hasCompletedOnboarding: false, hydrated: true })
    }
  },

  markCompletedSyncedWithAuth: async () => {
    await SecureStore.setItemAsync(ONBOARDING_COMPLETED_KEY, 'true')
    set({ hasCompletedOnboarding: true })
  },
}))
