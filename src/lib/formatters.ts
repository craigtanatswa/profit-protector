import { normalizeZigRatePerUsd } from './currencyDisplay'

/**
 * @param usdCents — amounts in the database are always US dollar cents
 * @param currency — business display mode: USD | ZiG | Both
 * @param zigRatePerUsd — ZiG per 1 USD (e.g. 30 → $5.00 → ZiG 150.00)
 */
export function formatCurrency(
  usdCents: number,
  currency = 'USD',
  zigRatePerUsd: number = 1,
): string {
  const rate = normalizeZigRatePerUsd(zigRatePerUsd)
  const usdAmount = usdCents / 100

  if (currency === 'USD') {
    return `$${usdAmount.toFixed(2)}`
  }

  if (currency === 'ZiG') {
    const zig = usdAmount * rate
    return `ZiG ${zig.toFixed(2)}`
  }

  if (currency === 'Both') {
    const zig = usdAmount * rate
    return `$${usdAmount.toFixed(2)} · ZiG ${zig.toFixed(2)}`
  }

  return `$${usdAmount.toFixed(2)}`
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`
}

export function formatPaymentMethod(method: string): string {
  const labels: Record<string, string> = {
    cash_usd: 'Cash (USD)',
    cash_zig: 'Cash (ZiG)',
    ecocash: 'EcoCash',
    onemoney: 'OneMoney',
    innbucks: 'InnBucks',
    card: 'Zimswitch',
    zimswitch: 'Zimswitch',
    vmc: 'Visa / Mastercard',
    bank_transfer: 'Bank Transfer',
    credit: 'Credit / Owing',
  }
  return labels[method] ?? method
}

export function formatMonthYear(timestamp: number): string {
  const date = new Date(timestamp)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${months[date.getMonth()]} ${date.getFullYear()}`
}

/** e.g. "chipo@gmail.com" → "ch***@gmail.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (domain == null || domain === '' || local == null) {
    return email
  }
  const prefix = local.length >= 2 ? local.slice(0, 2) : local
  const masked = `${prefix}***`
  return `${masked}@${domain}`
}
