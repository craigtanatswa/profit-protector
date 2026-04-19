/**
 * creditLedger.ts
 *
 * THE single source of truth for all outstanding-balance figures shown anywhere
 * in the app (customer list card, customer detail hero, dashboard credit rows).
 *
 * Formula
 * -------
 *   outstanding(customer) = Σ max(0, amountCents − amountPaidCents)
 *                            for every credit_sales row belonging to that customer
 *
 * This is computed directly from live WatermelonDB credit_sales rows. The
 * customer.outstanding_balance_cents column is a denormalised write-cache used
 * only for Supabase sync — it is NEVER used for display.
 *
 * All three consumers (useCustomers, useCustomerDetail, useDashboard) import
 * ONLY from this file for any credit-balance arithmetic.
 */

/** Shape accepted from WatermelonDB credit_sales rows. */
export interface CreditRow {
  customerId: string
  amountCents: number
  amountPaidCents: number
}

/**
 * Remaining owed on a single credit-sale line.
 * Clamped to zero so partial over-payments never go negative.
 */
export function lineRemaining(row: Pick<CreditRow, 'amountCents' | 'amountPaidCents'>): number {
  return Math.max(0, row.amountCents - row.amountPaidCents)
}

/**
 * Outstanding balance for ONE customer.
 * Pass the customer's credit_sales rows (already filtered to that customer, or unfiltered —
 * any rows not matching customerId are ignored when using creditRowsForCustomer first).
 *
 * This is the ONLY function called to produce a number shown in the UI.
 */
export function customerOutstanding(
  rows: ReadonlyArray<Pick<CreditRow, 'amountCents' | 'amountPaidCents'>>,
): number {
  let total = 0
  for (const row of rows) total += lineRemaining(row)
  return total
}

/**
 * Filter a business-wide credit_sales array down to one customer's rows.
 * Use this in the list and dashboard where all rows are loaded together.
 */
export function creditRowsForCustomer(
  allRows: ReadonlyArray<CreditRow>,
  customerId: string,
): CreditRow[] {
  const out: CreditRow[] = []
  for (const r of allRows) {
    if (r.customerId === customerId) out.push(r)
  }
  return out
}

/**
 * Build a map { customerId → outstandingCents } from a batch of credit_sales rows.
 * Used by the list and dashboard to compute all customer balances in one pass.
 */
export function buildOutstandingMap(
  rows: ReadonlyArray<CreditRow>,
  customerIds: ReadonlySet<string>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (!customerIds.has(row.customerId)) continue
    map.set(row.customerId, (map.get(row.customerId) ?? 0) + lineRemaining(row))
  }
  return map
}
