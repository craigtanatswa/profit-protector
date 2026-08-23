import { useCallback, useEffect } from 'react'
import { AppState } from 'react-native'

import { useAuthStore } from '../stores/authStore'
import { useSubscriptionStore } from '../stores/subscriptionStore'
import { fetchSubscription } from '../lib/subscription'
import { canUseCutProducts, getMaxShopkeepers, PLANS, type PlanTier } from '../lib/plans'

export function useSubscription() {
  const businessId = useAuthStore((s) => s.business?.id)

  const subscription = useSubscriptionStore((s) => s.subscription)
  const isLoading = useSubscriptionStore((s) => s.isLoading)
  const hasFetched = useSubscriptionStore((s) => s.hasFetched)

  const setSubscription = useSubscriptionStore((s) => s.setSubscription)
  const setLoading = useSubscriptionStore((s) => s.setLoading)
  const setHasFetched = useSubscriptionStore((s) => s.setHasFetched)

  useEffect(() => {
    if (!businessId) return
    setLoading(true)
    fetchSubscription(businessId)
      .then((sub) => {
        setSubscription(sub)
      })
      .catch((err) => {
        console.warn('[useSubscription] fetchSubscription error:', err)
        // Keep whatever subscription was already in the store on error so a
        // transient network blip doesn't revoke access mid-session.
      })
      .finally(() => {
        setLoading(false)
        setHasFetched(true)
      })
  }, [businessId, setLoading, setSubscription, setHasFetched])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && businessId) {
        fetchSubscription(businessId)
          .then(setSubscription)
          .catch((err) => console.warn('[useSubscription] background refetch error:', err))
      }
    })
    return () => sub.remove()
  }, [businessId, setSubscription])

  const refetch = useCallback(async () => {
    if (!businessId) return
    try {
      const next = await fetchSubscription(businessId)
      setSubscription(next)
    } catch (err) {
      console.warn('[useSubscription] refetch error:', err)
    }
  }, [businessId, setSubscription])

  const isActive = subscription?.status === 'active'

  const planTier: PlanTier = subscription?.planTier ?? 'pro'
  const maxShopkeepers = getMaxShopkeepers(planTier)
  const cutProductsEnabled = canUseCutProducts({
    planTier,
    status: subscription?.status,
  })

  const isTrialExpired =
    subscription?.status === 'expired' ||
    (subscription?.status === 'trial' && new Date(subscription.trialEnd) < new Date())

  const daysRemainingInTrial = (() => {
    if (!subscription) return 30
    const end = new Date(subscription.trialEnd)
    const diffMs = end.getTime() - Date.now()
    return Math.max(0, Math.ceil(diffMs / 86400000))
  })()

  const trialEndDate = subscription ? new Date(subscription.trialEnd) : null

  const nextBillingDate = subscription?.nextBillingDate
    ? new Date(subscription.nextBillingDate)
    : null

  /** Whether the business can upgrade from Pro → Pro+ right now. */
  const canUpgrade = isActive && planTier === 'pro'

  /**
   * Proration breakdown for a Pro → Pro+ mid-cycle upgrade.
   * All amounts in cents. Null if the upgrade is not applicable.
   */
  const upgradeProration = (() => {
    if (!canUpgrade || !subscription?.currentPeriodStart || !subscription?.currentPeriodEnd) return null
    const nowMs = Date.now()
    const startMs = Date.parse(subscription.currentPeriodStart)
    const endMs = Date.parse(subscription.currentPeriodEnd)
    const totalMs = Math.max(1, endMs - startMs)
    const remainingMs = Math.max(0, endMs - nowMs)
    const daysRemaining = Math.ceil(remainingMs / 86400000)
    const totalDays = Math.round(totalMs / 86400000)
    const fraction = remainingMs / totalMs
    const creditCents = Math.floor(fraction * PLANS.pro.priceCents)
    const prosPlusCostCents = Math.ceil(fraction * PLANS.pro_plus.priceCents)
    const chargeCents = Math.max(0, prosPlusCostCents - creditCents)
    return { daysRemaining, totalDays, creditCents, prosPlusCostCents, chargeCents, isFree: chargeCents < 50 }
  })()

  const canUseApp = (() => {
    // Optimistic allow while the first fetch hasn't completed yet — avoids a
    // paywall flash on cold start before we know the subscription state.
    if (!hasFetched) return true
    // After first fetch, null means we cannot verify entitlement.
    if (!subscription) return false
    if (subscription.status === 'trial') {
      const graceEnd = new Date(subscription.trialEnd)
      graceEnd.setHours(graceEnd.getHours() + 6)
      return Date.now() < graceEnd.getTime()
    }
    return subscription.status === 'active' || subscription.status === 'grace'
  })()

  return {
    subscription,
    isLoading,
    canUseApp,
    isActive,
    isTrialExpired,
    daysRemainingInTrial,
    trialEndDate,
    nextBillingDate,
    planTier,
    maxShopkeepers,
    canUseCutProducts: cutProductsEnabled,
    canUpgrade,
    upgradeProration,
    refetch,
  }
}
