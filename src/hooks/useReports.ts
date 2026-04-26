import { useCallback, useEffect, useRef, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { PaymentMethod } from '../types'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentBreakdownItem {
  method: PaymentMethod
  totalCents: number
  count: number
  percent: number
}

export interface DailyDataPoint {
  label: string
  totalCents: number
  date: number
}

export interface TopProduct {
  productId: string
  productName: string
  qtySold: number
  revenueCents: number
  profitCents: number
  marginPercent: number
}

interface ReportsState {
  totalRevenueCents: number
  totalProfitCents: number
  cogsCents: number
  grossMarginPercent: number
  transactionCount: number
  totalQtySold: number
  avgSaleValueCents: number
  avgProfitCents: number
  paymentBreakdown: PaymentBreakdownItem[]
  dailyData: DailyDataPoint[]
  topProducts: TopProduct[]
  /** Earliest sale timestamp in the current query (for “all time” export labels) */
  earliestSaleMs: number | null
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const EMPTY: ReportsState = {
  totalRevenueCents: 0,
  totalProfitCents: 0,
  cogsCents: 0,
  grossMarginPercent: 0,
  transactionCount: 0,
  totalQtySold: 0,
  avgSaleValueCents: 0,
  avgProfitCents: 0,
  paymentBreakdown: [],
  dailyData: [],
  topProducts: [],
  earliestSaleMs: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ONE_DAY_MS = 86_400_000
/** Parent passes `startMs === 0` for all-time: no `created_at` lower bound. */
const ALL_TIME_START_MS = 0
const MAX_DAYS_DAILY_CHART = 60

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDayLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

function getCreatedAtMs(createdAt: Date | number): number {
  return createdAt instanceof Date ? createdAt.getTime() : (createdAt as number)
}

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useReports
 *
 * Reads report data from WatermelonDB for the given date range.
 * Re-runs whenever businessId, startMs, or endMs changes.
 * Not reactive — call refetch() to force a refresh.
 */
export function useReports(businessId: string, startMs: number, endMs: number) {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState<ReportsState>(EMPTY)
  const [refreshToken, setRefreshToken] = useState(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!database || !businessId) {
      setIsLoading(false)
      return
    }

    cancelledRef.current = false
    setIsLoading(true)

    const fetchData = async () => {
      try {
        // 1. Fetch all sales in date range (all-time: no lower bound on created_at)
        const isAllTime = startMs === ALL_TIME_START_MS
        const salesRaw = isAllTime
          ? await database!
              .get<SaleModel>('sales')
              .query(Q.where('business_id', businessId), Q.where('created_at', Q.lte(endMs)))
              .fetch()
          : await database!
              .get<SaleModel>('sales')
              .query(
                Q.where('business_id', businessId),
                Q.where('created_at', Q.gte(startMs)),
                Q.where('created_at', Q.lte(endMs)),
              )
              .fetch()

        if (cancelledRef.current) return

        // 2. Batch-fetch all sale_items for those sales
        const saleIds = salesRaw.map(s => s.id)
        const allItemsRaw: SaleItemModel[] =
          saleIds.length > 0
            ? await database!
                .get<SaleItemModel>('sale_items')
                .query(Q.where('sale_id', Q.oneOf(saleIds)))
                .fetch()
            : []

        if (cancelledRef.current) return

        // 3. Index items by sale_id
        const itemsBySaleId = new Map<string, SaleItemModel[]>()
        for (const item of allItemsRaw) {
          const arr = itemsBySaleId.get(item.saleId) ?? []
          arr.push(item)
          itemsBySaleId.set(item.saleId, arr)
        }

        // 4. Single-day hourly vs multi-day (all-time is never a single UI day)
        const isSingleDay = !isAllTime && endMs - startMs <= ONE_DAY_MS

        // 5. Accumulators
        let totalRevenueCents = 0
        let cogsCents = 0
        let totalQtySold = 0

        const paymentMap = new Map<string, { totalCents: number; count: number }>()
        const dailyMap = new Map<string, { totalCents: number; date: number }>()
        const hourlyArr = new Array(24).fill(0) as number[]
        const productMap = new Map<string, {
          name: string
          qtySold: number
          revenueCents: number
          costCents: number
        }>()

        for (const sale of salesRaw) {
          const createdMs = getCreatedAtMs(sale.createdAt)
          totalRevenueCents += sale.totalCents

          // Payment breakdown
          const method = sale.paymentMethod
          const pmPrev = paymentMap.get(method) ?? { totalCents: 0, count: 0 }
          paymentMap.set(method, {
            totalCents: pmPrev.totalCents + sale.totalCents,
            count: pmPrev.count + 1,
          })

          // Daily / hourly bucketing
          if (isSingleDay) {
            const hour = new Date(createdMs).getHours()
            hourlyArr[hour] += sale.totalCents
          } else {
            const saleDate = new Date(createdMs)
            const k = dayKey(saleDate)
            const prev = dailyMap.get(k) ?? { totalCents: 0, date: startOfDayMs(saleDate) }
            dailyMap.set(k, { totalCents: prev.totalCents + sale.totalCents, date: prev.date })
          }

          // Items: COGS, qty, product aggregation
          const items = itemsBySaleId.get(sale.id) ?? []
          for (const item of items) {
            cogsCents += item.costPriceCents * item.qty
            totalQtySold += item.qty

            const prev = productMap.get(item.productId) ?? {
              name: item.productNameSnapshot,
              qtySold: 0,
              revenueCents: 0,
              costCents: 0,
            }
            productMap.set(item.productId, {
              name: prev.name,
              qtySold: prev.qtySold + item.qty,
              revenueCents: prev.revenueCents + item.unitPriceCents * item.qty,
              costCents: prev.costCents + item.costPriceCents * item.qty,
            })
          }
        }

        // 6. Build dailyData (hourly or daily, with zeros filled)
        const dailyData: DailyDataPoint[] = []

        if (isSingleDay) {
          // Hourly: 24 entries labelled at 12am, 6am, 12pm, 6pm
          const baseDate = new Date(startMs)
          baseDate.setHours(0, 0, 0, 0)
          for (let h = 0; h < 24; h++) {
            let label = ''
            if (h === 0) label = '12am'
            else if (h === 6) label = '6am'
            else if (h === 12) label = '12pm'
            else if (h === 18) label = '6pm'
            dailyData.push({
              label,
              totalCents: hourlyArr[h],
              date: new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), h).getTime(),
            })
          }
        } else {
          const endDayForSeries = startOfDayMs(new Date(endMs))

          if (isAllTime && salesRaw.length === 0) {
            // no-op: dailyData stays []
          } else {
            const seriesStartForRange =
              isAllTime
                ? startOfDayMs(
                    new Date(
                      Math.min(...salesRaw.map(s => getCreatedAtMs(s.createdAt))),
                    ),
                  )
                : startOfDayMs(new Date(startMs))

            const rangeDays =
              Math.floor((endDayForSeries - seriesStartForRange) / ONE_DAY_MS) + 1
            const useMonthBuckets = rangeDays > MAX_DAYS_DAILY_CHART

            if (useMonthBuckets) {
              const monthAgg = new Map<
                string,
                { totalCents: number; firstOfMonth: number }
              >()
              for (const { totalCents, date } of dailyMap.values()) {
                const d = new Date(date)
                const mk = monthKeyFromDate(d)
                const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
                const prev = monthAgg.get(mk) ?? { totalCents: 0, firstOfMonth }
                monthAgg.set(mk, {
                  totalCents: prev.totalCents + totalCents,
                  firstOfMonth: prev.firstOfMonth,
                })
              }
              const startM = new Date(seriesStartForRange)
              let mCursor = new Date(startM.getFullYear(), startM.getMonth(), 1)
              const endD = new Date(endDayForSeries)
              const endMonthDate = new Date(endD.getFullYear(), endD.getMonth(), 1)
              while (mCursor <= endMonthDate) {
                const mk = monthKeyFromDate(mCursor)
                const ent = monthAgg.get(mk) ?? {
                  totalCents: 0,
                  firstOfMonth: mCursor.getTime(),
                }
                dailyData.push({
                  label: `${MONTHS_SHORT[mCursor.getMonth()]} ${String(
                    mCursor.getFullYear(),
                  ).slice(-2)}`,
                  totalCents: ent.totalCents,
                  date: new Date(
                    mCursor.getFullYear(),
                    mCursor.getMonth(),
                    1,
                  ).getTime(),
                })
                mCursor = new Date(mCursor.getFullYear(), mCursor.getMonth() + 1, 1)
              }
            } else {
              // Daily: fill every day in range with zeros where no sales
              let cursor = seriesStartForRange
              while (cursor <= endDayForSeries) {
                const d = new Date(cursor)
                const k = dayKey(d)
                const entry = dailyMap.get(k)
                dailyData.push({
                  label: formatDayLabel(d),
                  totalCents: entry?.totalCents ?? 0,
                  date: cursor,
                })
                cursor += ONE_DAY_MS
              }
            }
          }
        }

        // 7. Payment breakdown array
        const grandTotal = totalRevenueCents || 1
        const paymentBreakdown: PaymentBreakdownItem[] = Array.from(paymentMap.entries())
          .map(([method, { totalCents, count }]) => ({
            method: method as PaymentMethod,
            totalCents,
            count,
            percent: parseFloat(((totalCents / grandTotal) * 100).toFixed(1)),
          }))
          .sort((a, b) => b.totalCents - a.totalCents)

        // 8. Top products
        const topProducts: TopProduct[] = Array.from(productMap.entries())
          .map(([productId, { name, qtySold, revenueCents, costCents }]) => {
            const profitCents = revenueCents - costCents
            return {
              productId,
              productName: name,
              qtySold,
              revenueCents,
              profitCents,
              marginPercent:
                revenueCents > 0
                  ? parseFloat(((profitCents / revenueCents) * 100).toFixed(1))
                  : 0,
            }
          })
          .sort((a, b) => b.revenueCents - a.revenueCents)

        // 9. Derived metrics
        const transactionCount = salesRaw.length
        const totalProfitCents = totalRevenueCents - cogsCents
        const grossMarginPercent =
          totalRevenueCents > 0
            ? parseFloat(((totalProfitCents / totalRevenueCents) * 100).toFixed(1))
            : 0
        const avgSaleValueCents =
          transactionCount > 0 ? Math.round(totalRevenueCents / transactionCount) : 0
        const avgProfitCents =
          transactionCount > 0 ? Math.round(totalProfitCents / transactionCount) : 0

        const earliestSaleMs =
          salesRaw.length > 0
            ? Math.min(...salesRaw.map(s => getCreatedAtMs(s.createdAt)))
            : null

        if (!cancelledRef.current) {
          setData({
            totalRevenueCents,
            totalProfitCents,
            cogsCents,
            grossMarginPercent,
            transactionCount,
            totalQtySold,
            avgSaleValueCents,
            avgProfitCents,
            paymentBreakdown,
            dailyData,
            topProducts,
            earliestSaleMs,
          })
          setIsLoading(false)
        }
      } catch (err) {
        console.error('[useReports] fetchData error:', err)
        if (!cancelledRef.current) setIsLoading(false)
      }
    }

    fetchData()

    return () => {
      cancelledRef.current = true
    }
  }, [businessId, startMs, endMs, refreshToken])

  const refetch = useCallback(() => setRefreshToken(t => t + 1), [])

  return { ...data, isLoading, refetch }
}
