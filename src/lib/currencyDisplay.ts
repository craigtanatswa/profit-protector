/**
 * All ledger amounts are USD cents. These helpers convert for display when
 * the business uses ZiG or dual display.
 */

export function normalizeZigRatePerUsd(rate: number | null | undefined): number {
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0) return 1
  return n
}

/** USD dollars from cents */
export function usdCentsToUsd(usdCents: number): number {
  return usdCents / 100
}

/** ZiG amount = USD dollars × rate (rate = ZiG per $1) */
export function usdCentsToZigAmount(usdCents: number, zigRatePerUsd: number): number {
  return usdCentsToUsd(usdCents) * normalizeZigRatePerUsd(zigRatePerUsd)
}

/**
 * For CSV/PDF numeric cells: values native USD dollars, or ZiG dollars when
 * display currency is ZiG only. When "Both", keep USD in numeric columns for
 * spreadsheet clarity (ZiG shown in-app via formatCurrency).
 */
export function usdCentsToExportAmount(
  usdCents: number,
  currency: string,
  zigRatePerUsd: number,
): number {
  const usd = usdCentsToUsd(usdCents)
  if (currency === 'ZiG') return usd * normalizeZigRatePerUsd(zigRatePerUsd)
  return usd
}
