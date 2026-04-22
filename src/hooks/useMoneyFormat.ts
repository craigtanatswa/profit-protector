import { useCallback } from 'react'
import { formatCurrency } from '../lib/formatters'
import { useAuthStore } from '../stores/authStore'

/**
 * Money stored in the database is always USD cents.
 * ZiG / Both display uses `zigRatePerUsd` (ZiG per $1 USD).
 */
export function useMoneyFormat() {
  const business = useAuthStore((s) => s.business)
  const currency = business?.currency ?? 'USD'
  const zigRatePerUsd = business?.zigRatePerUsd ?? 1

  const formatMoney = useCallback(
    (usdCents: number) => formatCurrency(usdCents, currency, zigRatePerUsd),
    [currency, zigRatePerUsd],
  )

  return { formatMoney, currency, zigRatePerUsd }
}
