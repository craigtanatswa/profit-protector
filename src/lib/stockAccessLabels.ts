import type { StockAccessType } from '../types'

export function stockAccessTypeLabel(type: StockAccessType): string {
  return type === 'receive' ? 'Add stock' : 'Adjust stock'
}

export function stockAccessRequestBody(type: StockAccessType): string {
  return type === 'receive'
    ? 'Wants to add or receive stock'
    : 'Wants to adjust stock'
}

export function stockAccessPendingMessage(type: StockAccessType): string {
  return type === 'receive'
    ? 'Your request to add or receive stock has been sent to the business owner.'
    : 'Your request to adjust stock has been sent to the business owner.'
}

export function stockAccessOwnerPush(type: StockAccessType, staffName: string): { title: string; body: string } {
  if (type === 'receive') {
    return {
      title: '📦 Staff Add Stock Request',
      body: `${staffName} wants to add or receive stock`,
    }
  }
  return {
    title: '📦 Staff Adjust Stock Request',
    body: `${staffName} wants to adjust stock`,
  }
}
