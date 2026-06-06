import { useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import { customerOutstanding } from '../lib/creditLedger'
import { mapCustomerRecord } from './useCustomers'
import type { Customer, CreditSale, PaymentRecord } from '../types'
import type CreditSaleModel from '../database/models/CreditSale'
import type CustomerModel from '../database/models/Customer'
import type PaymentRecordModel from '../database/models/PaymentRecord'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapCreditSaleRecord(record: CreditSaleModel): CreditSale {
  return {
    id: record.id,
    saleId: record.saleId,
    customerId: record.customerId,
    amountCents: record.amountCents,
    amountPaidCents: record.amountPaidCents,
    isSettled: record.isSettled,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

export function mapPaymentRecord(record: PaymentRecordModel): PaymentRecord {
  return {
    id: record.id,
    customerId: record.customerId,
    amountCents: record.amountCents,
    paymentMethod: record.paymentMethod,
    notes: record.notes ?? undefined,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerDetailResult {
  customer: Customer | null
  creditSales: CreditSale[]
  paymentRecords: PaymentRecord[]
  totalCreditCents: number
  totalPaidBackCents: number
  totalSpentCents: number
  isLoading: boolean
  error: string | null
  /** Re-read customer + credit + payments from WatermelonDB (e.g. screen focus). */
  refreshFromLocal: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useCustomerDetail
 *
 * Subscribes to WatermelonDB `customers`, `credit_sales`, and `payment_records`
 * via `observe()`.  All three subscriptions write into local ref-variables; a
 * single microtask merges them into one React state update so the UI never sees
 * a half-updated snapshot.
 *
 * Outstanding balance  =  Σ max(0, amountCents − amountPaidCents)
 *                          over THIS customer's credit_sales rows.
 *
 * This is the SAME formula as useCustomers and useDashboard.
 * customer.outstanding_balance_cents is NEVER used for display.
 */
const INITIAL: Omit<CustomerDetailResult, 'refreshFromLocal'> = {
  customer: null,
  creditSales: [],
  paymentRecords: [],
  totalCreditCents: 0,
  totalPaidBackCents: 0,
  totalSpentCents: 0,
  isLoading: true,
  error: null,
}

export function useCustomerDetail(customerId: string): CustomerDetailResult {
  const [state, setState] = useState<Omit<CustomerDetailResult, 'refreshFromLocal'>>(INITIAL)
  const refreshFromLocalRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (!database || !customerId) {
      refreshFromLocalRef.current = async () => {}
      setState({
        ...INITIAL,
        isLoading: false,
        error: customerId ? 'Database not available' : null,
      })
      return
    }

    // Reset so stale data from a previous customer is never shown
    setState({ ...INITIAL, isLoading: true, error: null })

    let cancelled = false

    // Live model snapshots — updated synchronously inside each observe() callback
    let customerModel: CustomerModel | null = null
    let creditModels: CreditSaleModel[] = []
    let paymentModels: PaymentRecordModel[] = []

    // ── Merge ────────────────────────────────────────────────────────────────
    // Recomputes derived values and writes to React state in one call.
    // Called from a microtask so all three observers have settled first.
    function merge() {
      if (cancelled || customerModel === null) return

      if (customerModel.isActive === false) {
        setState({
          ...INITIAL,
          isLoading: false,
          error: 'Customer not found',
        })
        return
      }

      const creditSales = creditModels.map(mapCreditSaleRecord)
      const paymentRecords = paymentModels.map(mapPaymentRecord)

      // THE balance formula — same as useCustomers / useDashboard
      const outstandingBalanceCents = customerOutstanding(creditModels)

      const totalCreditCents = creditModels.reduce((s, cs) => s + cs.amountCents, 0)
      const totalPaidBackCents = creditModels.reduce((s, cs) => s + cs.amountPaidCents, 0)

      const customer: Customer = {
        ...mapCustomerRecord(customerModel),
        outstandingBalanceCents,
      }

      setState({
        customer,
        creditSales,
        paymentRecords,
        totalCreditCents,
        totalPaidBackCents,
        totalSpentCents: totalCreditCents,
        isLoading: false,
        error: null,
      })
    }

    /** Double microtask so all three observers finish for the same DB write. */
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
      .findAndObserve(customerId)
      .subscribe({
        next: (record) => {
          customerModel = record
          scheduleMerge()
        },
        error: () => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, error: 'Customer not found', isLoading: false }))
          }
        },
      })

    // Credit sales — newest first for display in the UI
    const creditSub = database
      .get<CreditSaleModel>('credit_sales')
      .query(Q.where('customer_id', customerId), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe({
        next: (records) => {
          creditModels = records
          scheduleMerge()
        },
        error: () => {},
      })

    // Payment records — newest first for display in the UI
    const paymentSub = database
      .get<PaymentRecordModel>('payment_records')
      .query(Q.where('customer_id', customerId), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe({
        next: (records) => {
          paymentModels = records
          scheduleMerge()
        },
        error: () => {},
      })

    refreshFromLocalRef.current = async () => {
      if (cancelled || !database || !customerId) return
      try {
        customerModel = await database.get<CustomerModel>('customers').find(customerId)
        creditModels = await database
          .get<CreditSaleModel>('credit_sales')
          .query(Q.where('customer_id', customerId), Q.sortBy('created_at', Q.desc))
          .fetch()
        paymentModels = await database
          .get<PaymentRecordModel>('payment_records')
          .query(Q.where('customer_id', customerId), Q.sortBy('created_at', Q.desc))
          .fetch()
        merge()
      } catch {
        // keep showing last good state
      }
    }

    return () => {
      cancelled = true
      customerSub.unsubscribe()
      creditSub.unsubscribe()
      paymentSub.unsubscribe()
    }
  }, [customerId])

  return {
    ...state,
    refreshFromLocal: () => refreshFromLocalRef.current(),
  }
}
