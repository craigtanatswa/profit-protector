import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import { buildOutstandingMap } from '../lib/creditLedger'
import type { Customer } from '../types'
import type CreditSaleModel from '../database/models/CreditSale'
import type CustomerModel from '../database/models/Customer'

// ---------------------------------------------------------------------------
// Mapper — exported so useCustomerDetail can share it
// ---------------------------------------------------------------------------

export function mapCustomerRecord(record: CustomerModel): Customer {
  const raw = record.outstandingBalanceCents
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    phone: record.phone ?? undefined,
    nationalId: record.nationalId ?? undefined,
    // Row cache — will be overwritten with the ledger value before any UI sees it
    outstandingBalanceCents:
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0,
    isActive: record.isActive !== false,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useCustomers
 *
 * Subscribes to the local WatermelonDB `customers` and `credit_sales` tables
 * via `observe()`.  Uses **double** `queueMicrotask` so the merge runs after
 * WatermelonDB has finished notifying every collection touched by the same write
 * (customer row + credit lines), keeping the list in step with the detail screen.
 *
 * `refreshLocal()` re-fetches customers + credit_sales and merges immediately
 * (used for pull-to-refresh so balances match detail without waiting on observers).
 *
 * Outstanding balance  =  Σ max(0, amountCents − amountPaidCents)
 *                          over the customer's credit_sales rows.
 *
 * customer.outstanding_balance_cents (the DB row) is NEVER used for display.
 */
export function useCustomers(businessId: string) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)

  /** Shared snapshots — refs so `refreshLocal` can assign fresh fetches + merge. */
  const customerModelsRef = useRef<CustomerModel[]>([])
  const creditModelsRef = useRef<CreditSaleModel[]>([])
  const refreshFetchOnlyRef = useRef<() => Promise<void>>(async () => {})
  const commitMergeRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!businessId || !database) {
      setCustomers([])
      setIsLoading(false)
      refreshFetchOnlyRef.current = async () => {}
      commitMergeRef.current = () => {}
      return
    }

    let cancelled = false

    // The credit_sales subscription is recreated only when the set of customer
    // IDs changes (e.g. a new customer is added or one is deleted).
    let creditSub: { unsubscribe(): void } | undefined
    let lastCustomerIdsKey = ''

    // ── Merge ────────────────────────────────────────────────────────────────
    function merge() {
      if (cancelled) return

      const customerModels = customerModelsRef.current
      const creditModels = creditModelsRef.current

      const customerIdSet = new Set(customerModels.map((r) => r.id))

      const creditRows = creditModels.map((cs) => ({
        customerId: cs.customerId,
        amountCents: cs.amountCents,
        amountPaidCents: cs.amountPaidCents,
      }))

      const outstandingMap = buildOutstandingMap(creditRows, customerIdSet)

      const result: Customer[] = customerModels
        .filter((r) => r.isActive !== false)
        .map((r) => {
          const base = mapCustomerRecord(r)
          const outstandingBalanceCents = outstandingMap.get(base.id) ?? 0
          return { ...base, outstandingBalanceCents }
        })

      setCustomers(result)
      setIsLoading(false)
    }

    /**
     * Two microtasks: first runs after the current sync stack; second runs after
     * any other observers/microtasks Watermelon schedules for the same commit,
     * so customer + credit_sales refs both reflect the write before merge.
     */
    function scheduleMerge() {
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (!cancelled) merge()
        })
      })
    }

    // ── Subscriptions ────────────────────────────────────────────────────────

    const customerSub = database
      .get<CustomerModel>('customers')
      .query(Q.where('business_id', businessId), Q.sortBy('name', Q.asc))
      .observe()
      .subscribe((records) => {
        customerModelsRef.current = records

        const ids = records.map((r) => r.id)
        const key = [...ids].sort().join('\0')

        if (ids.length === 0) {
          creditSub?.unsubscribe()
          creditSub = undefined
          lastCustomerIdsKey = ''
          creditModelsRef.current = []
          scheduleMerge()
          return
        }

        if (key !== lastCustomerIdsKey) {
          lastCustomerIdsKey = key
          creditSub?.unsubscribe()
          creditSub = database!
            .get<CreditSaleModel>('credit_sales')
            .query(Q.where('customer_id', Q.oneOf(ids)))
            .observe()
            .subscribe((rows) => {
              creditModelsRef.current = rows
              scheduleMerge()
            })
        } else {
          scheduleMerge()
        }
      })

    commitMergeRef.current = () => {
      if (!cancelled) merge()
    }

    // Fetch only (no React update) — pull-to-refresh clears the spinner after this, then commits merge.
    refreshFetchOnlyRef.current = async () => {
      if (cancelled || !database) return
      try {
        // No name sort — list screen re-sorts by balance; skips sort cost on pull.
        const cust = await database
          .get<CustomerModel>('customers')
          .query(Q.where('business_id', businessId))
          .fetch()
        customerModelsRef.current = cust
        const ids = cust.map((c) => c.id)
        if (ids.length === 0) {
          creditModelsRef.current = []
        } else {
          const credit = await database
            .get<CreditSaleModel>('credit_sales')
            .query(Q.where('customer_id', Q.oneOf(ids)))
            .fetch()
          creditModelsRef.current = credit
        }
      } catch {
        // refs may be partial; merge still applies best-effort state
      }
    }

    return () => {
      cancelled = true
      creditSub?.unsubscribe()
      customerSub.unsubscribe()
    }
  }, [businessId])

  const refreshLocalFetchOnly = useCallback(async () => {
    await refreshFetchOnlyRef.current()
  }, [])

  const commitLocalMerge = useCallback(() => {
    commitMergeRef.current()
  }, [])

  /** Full local refresh: fetch + merge (e.g. focus / consistency). */
  const refreshLocal = useCallback(async () => {
    await refreshFetchOnlyRef.current()
    commitMergeRef.current()
  }, [])

  // ── Mutation helpers ──────────────────────────────────────────────────────

  const createCustomer = useCallback(
    async (name: string, phone?: string, nationalId?: string): Promise<Customer> => {
      if (!database) throw new Error('Database not available')
      const record = await database.write(async () =>
        database!.get<CustomerModel>('customers').create((c) => {
          c.businessId = businessId
          c.name = name.trim()
          c.phone = phone?.trim() || null
          c.nationalId = nationalId?.trim() || null
          c.outstandingBalanceCents = 0
          c.isActive = true
        }),
      )
      return mapCustomerRecord(record)
    },
    [businessId],
  )

  return {
    customers,
    isLoading,
    createCustomer,
    refreshLocal,
    refreshLocalFetchOnly,
    commitLocalMerge,
  }
}
