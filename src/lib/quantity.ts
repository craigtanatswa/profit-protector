export const QTY_DECIMALS = 3

/** Rounds a quantity to 3 decimal places to keep leftover stock stable. */
export function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0
  const factor = 10 ** QTY_DECIMALS
  return Math.round(n * factor) / factor
}

export function parseQty(raw: string): number | null {
  const n = parseFloat(raw.replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0) return null
  return roundQty(n)
}

/** Display 12, 12.5, or 1.350 without trailing zeros. */
export function formatQty(n: number): string {
  const rounded = roundQty(n)
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(QTY_DECIMALS).replace(/\.?0+$/, '')
}

export function formatQtyWithUnit(qty: number, unit: string): string {
  const u = unit.trim()
  return u.length > 0 ? `${formatQty(qty)} ${u}` : formatQty(qty)
}

export function lineTotalCents(qty: number, unitPriceCents: number): number {
  return Math.round(roundQty(qty) * unitPriceCents)
}

export function subtractQty(stock: number, sold: number): number {
  return Math.max(0, roundQty(stock - sold))
}

export function addQty(stock: number, incoming: number): number {
  return roundQty(stock + incoming)
}
