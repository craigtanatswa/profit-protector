import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import { formatDate, formatPaymentMethod } from './formatters'
import type SaleModel from '../database/models/Sale'
import type SaleItemModel from '../database/models/SaleItem'
import type CreditSaleModel from '../database/models/CreditSale'
import type CustomerModel from '../database/models/Customer'
import type ProductModel from '../database/models/Product'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessForCSV {
  id: string
  name: string
  currency: string
}

export interface ExportReportCSVParams {
  business: BusinessForCSV
  period: string
  startMs: number
  endMs: number
  businessId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeCsvField(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function getCreatedAtMs(createdAt: Date | number): number {
  return createdAt instanceof Date ? createdAt.getTime() : (createdAt as number)
}

// ---------------------------------------------------------------------------
// Export function
// ---------------------------------------------------------------------------

export async function exportReportCSV(params: ExportReportCSVParams): Promise<void> {
  const { business, period, startMs, endMs, businessId } = params

  if (!database) throw new Error('Database not available')

  // 1. Fetch all sales in date range (ordered by date ascending)
  const salesRaw = await database
    .get<SaleModel>('sales')
    .query(
      Q.where('business_id', businessId),
      Q.where('created_at', Q.gte(startMs)),
      Q.where('created_at', Q.lte(endMs)),
      Q.sortBy('created_at', Q.asc),
    )
    .fetch()

  // 2. Fetch all sale_items for those sales
  const saleIds = salesRaw.map(s => s.id)
  const allItemsRaw: SaleItemModel[] =
    saleIds.length > 0
      ? await database
          .get<SaleItemModel>('sale_items')
          .query(Q.where('sale_id', Q.oneOf(saleIds)))
          .fetch()
      : []

  // 3. Fetch credit_sale records to map sale_id -> customer_id
  const creditSaleIds = salesRaw
    .filter(s => s.paymentMethod === 'credit')
    .map(s => s.id)

  const creditSalesRaw: CreditSaleModel[] =
    creditSaleIds.length > 0
      ? await database
          .get<CreditSaleModel>('credit_sales')
          .query(Q.where('sale_id', Q.oneOf(creditSaleIds)))
          .fetch()
      : []

  const saleToCustomerMap = new Map<string, string>()
  for (const cs of creditSalesRaw) {
    saleToCustomerMap.set(cs.saleId, cs.customerId)
  }

  // 4. Fetch all customers for the business (for name lookup)
  const allCustomersRaw = await database
    .get<CustomerModel>('customers')
    .query(Q.where('business_id', businessId))
    .fetch()

  const customerMap = new Map<string, string>()
  for (const c of allCustomersRaw) {
    customerMap.set(c.id, c.name)
  }

  // 5. Fetch all products for the business (for category lookup)
  const allProductsRaw = await database
    .get<ProductModel>('products')
    .query(Q.where('business_id', businessId))
    .fetch()

  const productCategoryMap = new Map<string, string>()
  for (const p of allProductsRaw) {
    if (p.category) {
      productCategoryMap.set(p.id, p.category)
    }
  }

  // 6. Index items by sale_id
  const itemsBySaleId = new Map<string, SaleItemModel[]>()
  for (const item of allItemsRaw) {
    const arr = itemsBySaleId.get(item.saleId) ?? []
    arr.push(item)
    itemsBySaleId.set(item.saleId, arr)
  }

  // 7. Build CSV rows
  const headers = [
    'DATE',
    'TIME',
    'RECEIPT NO.',
    'PRODUCT',
    'CATEGORY',
    'QTY',
    'UNIT PRICE',
    'COST PRICE',
    'LINE TOTAL',
    'LINE PROFIT',
    'PAYMENT METHOD',
    'CUSTOMER',
  ]

  const rows: string[] = [headers.map(escapeCsvField).join(',')]

  // Summary accumulators — computed from sale.totalCents (actual collected revenue, after
  // discount) so they match the Reports screen exactly. Line-level totals use pre-discount
  // unit prices for transparency; a DISCOUNT row is added per sale when applicable.
  let totalRevenueCents = 0
  let totalCogsCents = 0

  for (const sale of salesRaw) {
    const saleMs = getCreatedAtMs(sale.createdAt)
    const dateStr = formatDate(saleMs)
    const timeStr = formatTime(saleMs)
    const paymentStr = formatPaymentMethod(sale.paymentMethod)
    const customerId = saleToCustomerMap.get(sale.id)
    const customerName = customerId ? (customerMap.get(customerId) ?? '') : ''
    const saleItems = itemsBySaleId.get(sale.id) ?? []

    // Accumulate using actual revenue (after discount) and COGS
    totalRevenueCents += sale.totalCents
    const saleCogs = saleItems.reduce((s, item) => s + item.costPriceCents * item.qty, 0)
    totalCogsCents += saleCogs

    if (saleItems.length === 0) {
      // Sale with no items — write one summary row
      rows.push(
        [
          escapeCsvField(dateStr),
          escapeCsvField(timeStr),
          escapeCsvField(sale.receiptNumber),
          escapeCsvField(''),
          escapeCsvField(''),
          escapeCsvField(0),
          escapeCsvField((sale.totalCents / 100).toFixed(2)),
          escapeCsvField('0.00'),
          escapeCsvField((sale.totalCents / 100).toFixed(2)),
          escapeCsvField('0.00'),
          escapeCsvField(paymentStr),
          escapeCsvField(customerName),
        ].join(','),
      )
    } else {
      for (const item of saleItems) {
        const lineTotal = item.unitPriceCents * item.qty
        const lineCost = item.costPriceCents * item.qty
        const lineProfit = lineTotal - lineCost
        const category = productCategoryMap.get(item.productId) ?? ''
        rows.push(
          [
            escapeCsvField(dateStr),
            escapeCsvField(timeStr),
            escapeCsvField(sale.receiptNumber),
            escapeCsvField(item.productNameSnapshot),
            escapeCsvField(category),
            escapeCsvField(item.qty),
            escapeCsvField((item.unitPriceCents / 100).toFixed(2)),
            escapeCsvField((item.costPriceCents / 100).toFixed(2)),
            escapeCsvField((lineTotal / 100).toFixed(2)),
            escapeCsvField((lineProfit / 100).toFixed(2)),
            escapeCsvField(paymentStr),
            escapeCsvField(customerName),
          ].join(','),
        )
      }

      // Add a DISCOUNT row so line totals − discount = actual revenue collected
      if (sale.discountCents > 0) {
        rows.push(
          [
            escapeCsvField(dateStr),
            escapeCsvField(timeStr),
            escapeCsvField(sale.receiptNumber),
            escapeCsvField('DISCOUNT'),
            escapeCsvField(''),
            escapeCsvField(''),
            escapeCsvField(''),
            escapeCsvField(''),
            escapeCsvField((-sale.discountCents / 100).toFixed(2)),
            escapeCsvField((-sale.discountCents / 100).toFixed(2)),
            escapeCsvField(paymentStr),
            escapeCsvField(customerName),
          ].join(','),
        )
      }
    }
  }

  const totalProfitCents = totalRevenueCents - totalCogsCents

  // 8. Summary rows at the bottom
  const isoNow = new Date().toISOString().replace('T', ' ').slice(0, 16)
  rows.push('')
  rows.push(['SUMMARY', '', '', '', '', '', '', '', '', '', '', ''].join(','))
  rows.push([`Period`, escapeCsvField(period), '', '', '', '', '', '', '', '', '', ''].join(','))
  rows.push([
    'Total Revenue',
    escapeCsvField((totalRevenueCents / 100).toFixed(2)),
    '', '', '', '', '', '', '', '', '', '',
  ].join(','))
  rows.push([
    'Total Profit',
    escapeCsvField((totalProfitCents / 100).toFixed(2)),
    '', '', '', '', '', '', '', '', '', '',
  ].join(','))
  rows.push([
    'Transactions',
    escapeCsvField(salesRaw.length),
    '', '', '', '', '', '', '', '', '', '',
  ].join(','))
  rows.push([
    'Generated',
    escapeCsvField(isoNow),
    '', '', '', '', '', '', '', '', '', '',
  ].join(','))

  const csvString = rows.join('\n')

  // 9. Write to filesystem and share
  const safeBusinessName = business.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const safePeriod = period.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const filename = `profit-protector-${safeBusinessName}-${safePeriod}.csv`

  const csvFile = new File(Paths.document, filename)
  csvFile.write(csvString)

  await Sharing.shareAsync(csvFile.uri, {
    mimeType: 'text/csv',
    dialogTitle: `Export ${period} Report`,
    UTI: 'public.comma-separated-values-text',
  })
}
