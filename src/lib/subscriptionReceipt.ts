import { Asset } from 'expo-asset'
import { File, Paths } from 'expo-file-system'
import { copyAsync, readAsStringAsync } from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import type { Business, Payment } from '../types'
import { formatDateTime, formatPaymentMethod } from './formatters'
import { planLabel, type PlanTier } from './plans'

async function getOfficialLogoDataUri(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(require('../../assets/logo-mark-blue.png'))
    await asset.downloadAsync()
    const uri = asset.localUri ?? asset.uri
    if (!uri) return null
    const b64 = await readAsStringAsync(uri, { encoding: 'base64' })
    return `data:image/png;base64,${b64}`
  } catch {
    return null
  }
}

export interface SubscriptionReceiptParams {
  payment: Payment
  business: Business
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function paymentReceiptNumber(payment: Payment): string {
  return payment.paynowReference?.trim() || `PP-${payment.id.slice(0, 8)}`
}

export function paymentDescription(payment: Payment): string {
  const plan = planLabel(payment.planTier as PlanTier)
  if (payment.isUpgrade) return `Profit Protector ${plan} upgrade`
  return `Profit Protector ${plan} monthly subscription`
}

export function formatPaymentAmount(cents: number, currency: string): string {
  const amount = ((cents ?? 0) / 100).toFixed(2)
  if ((currency || 'USD') === 'USD') return `$${amount}`
  return `${currency} ${amount}`
}

export function paymentStatusLabel(status: Payment['status']): string {
  switch (status) {
    case 'paid':
      return 'Paid'
    case 'pending':
      return 'Pending'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return String(status)
  }
}

function paidViaLine(payment: Payment): string {
  const method = formatPaymentMethod(payment.paymentMethod)
  if (payment.phoneNumber) return `${method} · ${payment.phoneNumber}`
  return method
}

function buildSubscriptionReceiptHTML(
  params: SubscriptionReceiptParams,
  logoDataUri: string | null,
): string {
  const { payment, business } = params
  const receiptNo = paymentReceiptNumber(payment)
  const createdMs = Date.parse(payment.createdAt)
  const dateLabel = Number.isFinite(createdMs) ? formatDateTime(createdMs) : payment.createdAt
  const amount = formatPaymentAmount(payment.amountCents, payment.currency)
  const status = paymentStatusLabel(payment.status)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { margin: 12mm; }
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
    .receipt { width: 100%; max-width: 100%; }
    .header-row { display: flex; align-items: center; }
    .logo-wrap {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      overflow: hidden;
      background: #fff;
      flex-shrink: 0;
    }
    .logo-wrap img { width: 56px; height: 56px; object-fit: contain; display: block; }
    .header-center { flex: 1; }
    .header-spacer { width: 56px; flex-shrink: 0; }
    .center { text-align: center; }
    .brand { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; color: #0047AB; text-transform: uppercase; }
    .title { font-size: 18px; font-weight: 700; text-align: center; margin-top: 4px; }
    .meta { font-size: 11px; color: #5A6A8A; text-align: center; margin-top: 4px; }
    .divider { border-top: 1px dashed #DDE3F0; margin: 10px 0; }
    .divider-solid { border-top: 1px solid rgba(13,27,62,0.2); margin: 8px 0; }
    .row { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; font-size: 13px; }
    .label { color: #5A6A8A; }
    .value { color: #0D1B3E; font-weight: 500; text-align: right; }
    .total-row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
    .total-label { font-size: 15px; font-weight: 700; }
    .total-value { font-size: 18px; font-weight: 700; color: #0047AB; }
    .status { font-weight: 700; }
    .footer { text-align: center; margin-top: 12px; font-size: 11px; color: #5A6A8A; font-style: italic; }
    .powered-by { text-align: center; font-size: 9px; color: #A8B4C8; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header-row">
      ${
        logoDataUri
          ? `<div class="logo-wrap"><img src="${logoDataUri}" alt="" /></div>`
          : `<div class="header-spacer"></div>`
      }
      <div class="header-center">
        <div class="center brand">Profit Protector</div>
        <div class="title">Payment Receipt</div>
        <div class="meta">${escapeHtml(receiptNo)}</div>
        <div class="meta">${escapeHtml(dateLabel)}</div>
      </div>
      <div class="header-spacer"></div>
    </div>
    <div class="divider"></div>

    <div class="row">
      <span class="label">Billed to</span>
      <span class="value">${escapeHtml(business.name || '—')}</span>
    </div>
    ${
      business.ownerName
        ? `<div class="row"><span class="label">Owner</span><span class="value">${escapeHtml(business.ownerName)}</span></div>`
        : ''
    }
    ${
      business.phone
        ? `<div class="row"><span class="label">Phone</span><span class="value">${escapeHtml(business.phone)}</span></div>`
        : ''
    }

    <div class="divider"></div>

    <div class="row">
      <span class="label">Description</span>
      <span class="value">${escapeHtml(paymentDescription(payment))}</span>
    </div>
    <div class="row">
      <span class="label">Paid via</span>
      <span class="value">${escapeHtml(paidViaLine(payment))}</span>
    </div>
    <div class="row">
      <span class="label">Status</span>
      <span class="value status">${escapeHtml(status)}</span>
    </div>
    ${
      payment.paynowStatus
        ? `<div class="row"><span class="label">Paynow status</span><span class="value">${escapeHtml(payment.paynowStatus)}</span></div>`
        : ''
    }

    <div class="divider-solid"></div>

    <div class="total-row">
      <span class="total-label">AMOUNT</span>
      <span class="total-value">${escapeHtml(amount)}</span>
    </div>

    <div class="divider"></div>
    <div class="footer">Thank you for subscribing to Profit Protector.</div>
    <div class="powered-by">This receipt confirms your in-app subscription payment.</div>
  </div>
</body>
</html>`
}

async function pdfUriWithFilename(tempUri: string, receiptNumber: string, businessName: string): Promise<string> {
  const safe = `Profit Protector ${receiptNumber}-${businessName}`.replace(/[/\\?%*:|"<>]/g, '-')
  const dest = new File(Paths.cache, `${safe}.pdf`)
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

export async function generateSubscriptionReceiptPDF(params: SubscriptionReceiptParams): Promise<string> {
  const html = buildSubscriptionReceiptHTML(params, await getOfficialLogoDataUri())
  const { uri } = await Print.printToFileAsync({ html, base64: false })
  return pdfUriWithFilename(uri, paymentReceiptNumber(params.payment), params.business.name)
}

export async function shareSubscriptionReceipt(params: SubscriptionReceiptParams): Promise<void> {
  try {
    const fileUri = await generateSubscriptionReceiptPDF(params)
    const receiptNo = paymentReceiptNumber(params.payment)
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Profit Protector ${receiptNo}-${params.business.name}`,
      UTI: 'com.adobe.pdf',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not share receipt: ${message}`)
  }
}

export async function printSubscriptionReceipt(params: SubscriptionReceiptParams): Promise<void> {
  try {
    await Print.printAsync({
      html: buildSubscriptionReceiptHTML(params, await getOfficialLogoDataUri()),
      printerUrl: undefined,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not print receipt: ${message}`)
  }
}
