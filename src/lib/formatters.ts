export function formatCurrency(cents: number, currency = 'USD'): string {
  const dollars = cents / 100
  const prefix = currency === 'USD' ? '$' : currency + ' '
  return `${prefix}${dollars.toFixed(2)}`
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

export function formatReceiptNumber(n: number): string {
  return `RCP-${String(n).padStart(4, '0')}`
}
