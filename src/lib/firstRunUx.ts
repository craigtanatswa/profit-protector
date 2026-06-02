import * as SecureStore from 'expo-secure-store'

const APPLIED_KEY_PREFIX = 'first_run_ux_reset_applied_'

/** Per-business keys written when welcome / inventory tutorial is dismissed. */
export function firstRunUxKeysForBusiness(businessId: string): string[] {
  return [
    `trial_welcome_shown_${businessId}`,
    `inventory_prompt_shown_${businessId}`,
    `product_tutorial_shown_${businessId}`,
    `sales_tutorial_shown_${businessId}`,
  ]
}

/** Device-wide keys tied to first-time owner dashboard prompts. */
export const FIRST_RUN_UX_GLOBAL_KEYS = ['shown_email_prompt'] as const

export async function clearFirstRunUxFlags(businessId: string): Promise<void> {
  await Promise.all([
    ...firstRunUxKeysForBusiness(businessId).map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => {}),
    ),
    ...FIRST_RUN_UX_GLOBAL_KEYS.map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => {}),
    ),
  ])
}

/**
 * When admin bumps `businesses.first_run_ux_reset_at`, clear local one-time UX
 * flags once per reset timestamp so welcome / tutorial can show again.
 */
export async function applyServerFirstRunUxResetIfNeeded(
  businessId: string,
  resetAt: string | null | undefined,
): Promise<void> {
  if (!resetAt || !businessId) return

  const resetMs = Date.parse(resetAt)
  if (!Number.isFinite(resetMs)) return

  const appliedKey = `${APPLIED_KEY_PREFIX}${businessId}`
  const lastApplied = await SecureStore.getItemAsync(appliedKey)
  if (lastApplied) {
    const lastMs = Date.parse(lastApplied)
    if (Number.isFinite(lastMs) && lastMs >= resetMs) return
  }

  await clearFirstRunUxFlags(businessId)
  await SecureStore.setItemAsync(appliedKey, resetAt)
}
