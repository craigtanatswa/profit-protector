import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { formatCurrency, formatDate, formatDateTime, formatPaymentMethod } from './formatters'
import type { PaymentBreakdownItem, TopProduct } from '../hooks/useReports'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessForReport {
  id: string
  name: string
  currency: string
}

export interface ExportReportPDFParams {
  business: BusinessForReport
  period: string
  startDate: Date
  endDate: Date
  totalRevenueCents: number
  totalProfitCents: number
  cogsCents: number
  grossMarginPercent: number
  transactionCount: number
  totalQtySold: number
  paymentBreakdown: PaymentBreakdownItem[]
  topProducts: TopProduct[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildReportHTML(params: ExportReportPDFParams): string {
  const {
    business,
    period,
    startDate,
    endDate,
    totalRevenueCents,
    totalProfitCents,
    cogsCents,
    grossMarginPercent,
    transactionCount,
    totalQtySold,
    paymentBreakdown,
    topProducts,
  } = params

  const currency = business.currency || 'USD'
  const generatedAt = formatDateTime(Date.now())
  const profitClass =
    totalProfitCents > 0 ? 'profit-positive' : totalProfitCents < 0 ? 'profit-negative' : ''
  const avgSaleValueCents =
    transactionCount > 0 ? Math.round(totalRevenueCents / transactionCount) : 0
  const avgProfitCents =
    transactionCount > 0 ? Math.round(totalProfitCents / transactionCount) : 0

  // Summary metrics grid
  const metricsHTML = `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Revenue</div>
        <div class="metric-value">${escapeHtml(formatCurrency(totalRevenueCents, currency))}</div>
        <div class="metric-sub">${transactionCount} transactions</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Profit</div>
        <div class="metric-value ${profitClass}">${escapeHtml(formatCurrency(totalProfitCents, currency))}</div>
        <div class="metric-sub">${grossMarginPercent}% margin</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Items Sold</div>
        <div class="metric-value">${totalQtySold} units</div>
        <div class="metric-sub">${topProducts.length} product${topProducts.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Sale Value</div>
        <div class="metric-value">${escapeHtml(formatCurrency(avgSaleValueCents, currency))}</div>
        <div class="metric-sub">per transaction</div>
      </div>
    </div>
  `

  // Payment methods table
  const paymentRowsHTML = paymentBreakdown
    .map(
      p => `
    <tr>
      <td>${escapeHtml(formatPaymentMethod(p.method))}</td>
      <td>${p.count}</td>
      <td style="text-align:right">${escapeHtml(formatCurrency(p.totalCents, currency))}</td>
      <td style="text-align:right">${p.percent}%</td>
    </tr>`,
    )
    .join('')

  const paymentTableHTML =
    paymentBreakdown.length > 0
      ? `
    <table>
      <thead>
        <tr>
          <th>Payment Method</th>
          <th>Transactions</th>
          <th style="text-align:right">Amount</th>
          <th style="text-align:right">% of Total</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRowsHTML}
        <tr class="total-row">
          <td>Total</td>
          <td>${transactionCount}</td>
          <td style="text-align:right">${escapeHtml(formatCurrency(totalRevenueCents, currency))}</td>
          <td style="text-align:right">100%</td>
        </tr>
      </tbody>
    </table>`
      : '<p style="color:#5A6A8A;font-size:12px;">No sales in this period.</p>'

  // Top 5 products table
  const top5 = topProducts.slice(0, 5)
  const productRowsHTML = top5
    .map(
      (p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(p.productName)}</td>
      <td style="text-align:right">${p.qtySold}</td>
      <td style="text-align:right">${escapeHtml(formatCurrency(p.revenueCents, currency))}</td>
      <td style="text-align:right" class="${p.profitCents > 0 ? 'profit-positive' : p.profitCents < 0 ? 'profit-negative' : ''}">${escapeHtml(formatCurrency(p.profitCents, currency))}</td>
      <td style="text-align:right">${p.marginPercent}%</td>
    </tr>`,
    )
    .join('')

  const productsTableHTML =
    top5.length > 0
      ? `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th style="text-align:right">Units Sold</th>
          <th style="text-align:right">Revenue</th>
          <th style="text-align:right">Profit</th>
          <th style="text-align:right">Margin</th>
        </tr>
      </thead>
      <tbody>
        ${productRowsHTML}
      </tbody>
    </table>`
      : '<p style="color:#5A6A8A;font-size:12px;">No products sold in this period.</p>'

  // Profit analysis table
  const profitAnalysisHTML = `
    <table>
      <tbody>
        <tr>
          <td>Total Revenue</td>
          <td style="text-align:right">${escapeHtml(formatCurrency(totalRevenueCents, currency))}</td>
        </tr>
        <tr>
          <td style="color:#C0152A">Cost of Goods Sold</td>
          <td style="text-align:right;color:#C0152A">− ${escapeHtml(formatCurrency(cogsCents, currency))}</td>
        </tr>
        <tr class="total-row">
          <td class="${profitClass}"><strong>Gross Profit</strong></td>
          <td style="text-align:right" class="${profitClass}"><strong>${escapeHtml(formatCurrency(totalProfitCents, currency))}</strong></td>
        </tr>
        <tr>
          <td>Profit Margin</td>
          <td style="text-align:right" class="${profitClass}">${grossMarginPercent}%</td>
        </tr>
        <tr>
          <td style="color:#5A6A8A">Avg Profit Per Sale</td>
          <td style="text-align:right;color:#5A6A8A">${escapeHtml(formatCurrency(avgProfitCents, currency))}</td>
        </tr>
      </tbody>
    </table>
  `

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #0D1B3E;
      padding: 20mm;
      max-width: 210mm;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0047AB;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .business-name {
      font-size: 24px;
      font-weight: 700;
      color: #0047AB;
    }
    .report-title {
      font-size: 16px;
      color: #5A6A8A;
      margin-top: 4px;
    }
    .period {
      font-size: 13px;
      color: #5A6A8A;
      margin-top: 4px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #0047AB;
      border-bottom: 1px solid #DDE3F0;
      padding-bottom: 6px;
      margin: 20px 0 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .metric-card {
      background: #F4F6FB;
      padding: 12px;
      border-radius: 8px;
    }
    .metric-label {
      font-size: 11px;
      color: #5A6A8A;
      margin-bottom: 4px;
    }
    .metric-value {
      font-size: 20px;
      font-weight: 700;
      color: #0D1B3E;
    }
    .metric-sub {
      font-size: 11px;
      color: #5A6A8A;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #E6EEFF;
      color: #0047AB;
      font-size: 11px;
      font-weight: 600;
      padding: 8px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 8px;
      border-bottom: 1px solid #F4F6FB;
      font-size: 12px;
    }
    tr:last-child td { border-bottom: none; }
    .total-row td {
      font-weight: 700;
      border-top: 1px solid #DDE3F0;
      padding-top: 10px;
    }
    .profit-positive { color: #0A7A4B; }
    .profit-negative { color: #C0152A; }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #DDE3F0;
      text-align: center;
      font-size: 10px;
      color: #5A6A8A;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="business-name">${escapeHtml(business.name)}</div>
    <div class="report-title">Business Report — ${escapeHtml(period)}</div>
    <div class="period">${escapeHtml(formatDate(startDate.getTime()))} to ${escapeHtml(formatDate(endDate.getTime()))}</div>
  </div>

  <div class="section-title">Summary</div>
  ${metricsHTML}

  <div class="section-title">Sales by Payment Method</div>
  ${paymentTableHTML}

  <div class="section-title">Top 5 Products</div>
  ${productsTableHTML}

  <div class="section-title">Profit Analysis</div>
  ${profitAnalysisHTML}

  <div class="footer">Generated by Profit Protector · ${escapeHtml(generatedAt)}</div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Export function
// ---------------------------------------------------------------------------

export async function exportReportPDF(params: ExportReportPDFParams): Promise<void> {
  const html = buildReportHTML(params)
  const { uri } = await Print.printToFileAsync({ html })
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf' })
}
