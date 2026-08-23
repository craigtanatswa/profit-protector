import { File, Paths } from 'expo-file-system'
import { copyAsync } from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as SecureStore from 'expo-secure-store'
import type { Sale, SaleItem, Business, Customer } from '../types'
import { getPersonalisation, normalizeBusinessType } from './appPersonalisation'
import { getBusinessLogoDataUri } from './businessLogo'
import { formatCurrency, formatDateTime, formatPaymentMethod } from './formatters'
import { formatQty, lineTotalCents } from './quantity'

interface ReceiptParams {
  sale: Sale
  saleItems: SaleItem[]
  business: Business
  customer?: Customer
  creditPaidCents?: number
  creditDepositMethod?: string
}

async function getReceiptFooterMessage(business: Business): Promise<string> {
  const raw = await SecureStore.getItemAsync('receipt_settings')
  if (raw != null && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as { footer?: string }
      const f = parsed.footer?.trim()
      if (f != null && f.length > 0) return f
    } catch {
      /* fall through */
    }
  }
  return getPersonalisation(normalizeBusinessType(business.businessType ?? 'other')).receiptFooter
}

const RECEIPT_SHARE_PREFIX = 'Profit Protector'

function receiptShareLabel(receiptNumber: string, businessName: string): string {
  const receipt = receiptNumber.trim() || 'receipt'
  const business = businessName.trim() || 'business'
  return `${RECEIPT_SHARE_PREFIX} ${receipt}-${business}`
}

function receiptPdfFilename(receiptNumber: string, businessName: string): string {
  const safe = receiptShareLabel(receiptNumber, businessName).replace(/[/\\?%*:|"<>]/g, '-')
  return `${safe}.pdf`
}

async function pdfUriWithReceiptFilename(
  tempUri: string,
  receiptNumber: string,
  businessName: string,
): Promise<string> {
  const dest = new File(Paths.cache, receiptPdfFilename(receiptNumber, businessName))
  if (dest.exists) {
    try {
      dest.delete()
    } catch {
      /* best effort */
    }
  }
  await copyAsync({ from: tempUri, to: dest.uri })
  return dest.uri
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildReceiptHTML(
  params: ReceiptParams,
  logoDataUri: string | null,
  footerMessage: string,
): string {
  const { sale, saleItems, business, customer, creditPaidCents = 0, creditDepositMethod } = params
  const currency = business.currency || 'USD'
  const zigRate = business.zigRatePerUsd ?? 1

  const subtotal = saleItems.reduce((sum, item) => sum + lineTotalCents(item.qty, item.unitPriceCents), 0)

  const itemsHTML = saleItems
    .map(
      (item) => `
    <div class="item-row">
      <div class="item-name">${escapeHtml(item.productNameSnapshot)}</div>
      <div class="item-qty">${formatQty(item.qty)}</div>
      <div class="item-price">${escapeHtml(formatCurrency(item.unitPriceCents, currency, zigRate))}</div>
      <div class="item-total">${escapeHtml(formatCurrency(lineTotalCents(item.qty, item.unitPriceCents), currency, zigRate))}</div>
    </div>`,
    )
    .join('')

  const discountHTML =
    sale.discountCents > 0
      ? `
    <div class="totals-row">
      <span class="totals-label">Discount</span>
      <span class="discount-value">-${escapeHtml(formatCurrency(sale.discountCents, currency, zigRate))}</span>
    </div>`
      : ''

  const partialCreditHTML =
    customer != null && creditPaidCents > 0 && creditPaidCents < sale.totalCents
      ? `
    <div class="payment-row">
      <span class="totals-label">Paid now</span>
      <span style="font-weight:500;">${escapeHtml(formatCurrency(creditPaidCents, currency, zigRate))}${
        creditDepositMethod
          ? ` via ${escapeHtml(formatPaymentMethod(creditDepositMethod))}`
          : ''
      }</span>
    </div>
    <div class="payment-row">
      <span class="totals-label">On credit</span>
      <span style="color:#B45309;font-weight:500;">${escapeHtml(formatCurrency(sale.totalCents - creditPaidCents, currency, zigRate))}</span>
    </div>`
      : ''

  const customerHTML =
    customer != null
      ? `
    <div class="payment-row">
      <span class="totals-label">Customer</span>
      <span style="font-weight:500;">${escapeHtml(customer.name)}</span>
    </div>
    ${partialCreditHTML}
    ${
      customer.outstandingBalanceCents > 0
        ? `<div class="payment-row">
      <span></span>
      <span style="color:#B45309;font-weight:500;">Balance owed: ${escapeHtml(formatCurrency(customer.outstandingBalanceCents, currency, zigRate))}</span>
    </div>`
        : ''
    }`
      : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { margin: 12mm; }
    html, body {
      width: 100%;
      min-height: 100%;
    }
    body {
      font-family: -apple-system, Arial, sans-serif;
      font-size: 13px;
      color: #0D1B3E;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
      margin: 0;
      padding: 12mm;
      background: #fff;
    }
    .receipt {
      width: 100%;
      max-width: 100%;
    }
    @media print {
      body {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        min-height: auto;
        padding: 0;
        margin: 0;
      }
      .receipt {
        width: 100%;
        max-width: 100%;
      }
    }
    .center { text-align: center; }
    .logo-wrap { margin-bottom: 8px; }
    .logo-img { max-height: 48px; max-width: 100%; object-fit: contain; }
    .business-name { font-size: 18px; font-weight: 700; text-align: center; margin-bottom: 2px; }
    .business-phone { font-size: 11px; color: #5A6A8A; text-align: center; margin-bottom: 8px; }
    .divider { border-top: 1px dashed #DDE3F0; margin: 8px 0; }
    .divider-solid { border-top: 1px solid rgba(13,27,62,0.2); margin: 8px 0; }
    .receipt-meta { font-size: 11px; color: #5A6A8A; text-align: center; margin-bottom: 4px; }
    .items-header { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; color: #5A6A8A; letter-spacing: 0.5px; margin-bottom: 4px; }
    .item-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 4px 0; border-bottom: 0.5px solid #F4F6FB; }
    .item-name { flex: 1; font-size: 13px; color: #0D1B3E; }
    .item-qty { width: 28px; text-align: center; font-size: 12px; color: #5A6A8A; }
    .item-price { width: 56px; text-align: right; font-size: 12px; color: #5A6A8A; }
    .item-total { width: 56px; text-align: right; font-size: 13px; font-weight: 600; color: #0D1B3E; }
    .totals-row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 13px; }
    .totals-label { color: #5A6A8A; }
    .totals-value { color: #0D1B3E; }
    .total-row { display: flex; justify-content: space-between; margin: 6px 0; }
    .total-label { font-size: 15px; font-weight: 700; color: #0D1B3E; }
    .total-value { font-size: 18px; font-weight: 700; color: #0047AB; }
    .discount-value { color: #C0152A; }
    .payment-row { display: flex; justify-content: space-between; font-size: 11px; margin-top: 4px; }
    .footer { text-align: center; margin-top: 12px; font-size: 11px; color: #5A6A8A; font-style: italic; }
    .powered-by { text-align: center; font-size: 9px; color: #DDE3F0; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="receipt">
  ${
    logoDataUri
      ? `<div class="center logo-wrap"><img class="logo-img" src="${logoDataUri}" alt="" /></div>`
      : ''
  }
  <div class="business-name">${escapeHtml(business.name)}</div>
  <div class="business-phone">${escapeHtml(business.phone)}</div>
  <div class="divider"></div>

  <div class="receipt-meta">${escapeHtml(sale.receiptNumber)}</div>
  <div class="receipt-meta">${escapeHtml(formatDateTime(sale.createdAt))}</div>
  <div class="divider"></div>

  <div class="items-header">
    <span>ITEM</span>
    <span>QTY&nbsp;&nbsp;PRICE&nbsp;&nbsp;TOTAL</span>
  </div>
  <div class="divider"></div>

  ${itemsHTML}

  <div class="divider"></div>

  <div class="totals-row">
    <span class="totals-label">Subtotal</span>
    <span class="totals-value">${escapeHtml(formatCurrency(subtotal, currency, zigRate))}</span>
  </div>

  ${discountHTML}

  <div class="divider-solid"></div>

  <div class="total-row">
    <span class="total-label">TOTAL</span>
    <span class="total-value">${escapeHtml(formatCurrency(sale.totalCents, currency, zigRate))}</span>
  </div>

  <div class="payment-row">
    <span class="totals-label">Paid via</span>
    <span style="font-weight:500;">${escapeHtml(formatPaymentMethod(sale.paymentMethod))}</span>
  </div>

  ${customerHTML}

  <div class="divider"></div>

  <div class="footer">${escapeHtml(footerMessage)}</div>
  <div class="center" style="font-size:11px;color:#5A6A8A;margin-top:4px;">${escapeHtml(business.name)}</div>
  <div class="powered-by">Powered by Profit Protector</div>
  </div>
</body>
</html>`
}

export async function generateReceiptPDF(params: ReceiptParams): Promise<string> {
  const logoDataUri = await getBusinessLogoDataUri()
  const footerMessage = await getReceiptFooterMessage(params.business)
  const html = buildReceiptHTML(params, logoDataUri, footerMessage)
  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
  })
  return pdfUriWithReceiptFilename(uri, params.sale.receiptNumber, params.business.name)
}

export async function shareReceipt(params: ReceiptParams): Promise<void> {
  try {
    const fileUri = await generateReceiptPDF(params)
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: receiptShareLabel(params.sale.receiptNumber, params.business.name),
      UTI: 'com.adobe.pdf',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not share receipt: ${message}`)
  }
}

export async function printReceiptBluetooth(params: ReceiptParams): Promise<void> {
  try {
    const logoDataUri = await getBusinessLogoDataUri()
    const footerMessage = await getReceiptFooterMessage(params.business)
    await Print.printAsync({
      html: buildReceiptHTML(params, logoDataUri, footerMessage),
      printerUrl: undefined,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not print receipt: ${message}`)
  }
}
