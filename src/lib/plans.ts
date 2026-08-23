export type PlanTier = 'pro' | 'pro_plus'

export interface PlanConfig {
  tier: PlanTier
  label: string
  /** Display label used on badges / short references */
  shortLabel: string
  priceCents: number
  /** Maximum number of non-deleted shopkeeper accounts allowed under this plan */
  maxShopkeepers: number
  /** Cut-from-piece products (meat, cloth) sold by measure */
  canUseCutProducts: boolean
  tagline: string
}

export const PLANS: Record<PlanTier, PlanConfig> = {
  pro: {
    tier: 'pro',
    label: 'Pro',
    shortLabel: 'Pro',
    // priceCents: 500, // live: $5.00
    priceCents: 20, // TEST: $0.20 — restore 500 before Play Store release
    maxShopkeepers: 1,
    canUseCutProducts: false,
    tagline: 'Perfect for sole traders',
  },
  pro_plus: {
    tier: 'pro_plus',
    label: 'Pro+',
    shortLabel: 'Pro+',
    // priceCents: 1000, // live: $10.00
    priceCents: 30, // TEST: $0.30 — restore 1000 before Play Store release
    maxShopkeepers: 5,
    canUseCutProducts: true,
    tagline: 'For businesses with staff',
  },
}

export function getMaxShopkeepers(tier: PlanTier | null | undefined): number {
  if (!tier) return PLANS.pro.maxShopkeepers
  return PLANS[tier]?.maxShopkeepers ?? PLANS.pro.maxShopkeepers
}

/** Trial unlocks Pro+ features so shops can evaluate cut-to-order stock. */
export function canUseCutProducts(params: {
  planTier?: PlanTier | null
  status?: string | null
}): boolean {
  if (params.status === 'trial') return true
  if (params.status !== 'active' && params.status !== 'grace') return false
  return params.planTier === 'pro_plus'
}

export function getPlanPriceCents(tier: PlanTier): number {
  return PLANS[tier]?.priceCents ?? PLANS.pro.priceCents
}

/** Formats a plan tier's price as a dollar string, e.g. "$5.00" */
export function formatPlanPrice(tier: PlanTier): string {
  const cents = getPlanPriceCents(tier)
  return `$${(cents / 100).toFixed(2)}`
}

/** Returns a human-readable plan label from a tier string (safe for unknown values). */
export function planLabel(tier: string | null | undefined): string {
  if (!tier) return PLANS.pro.label
  return PLANS[tier as PlanTier]?.label ?? tier
}
