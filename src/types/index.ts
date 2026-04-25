export interface Business {
  id: string
  name: string
  ownerName: string
  phone: string
  businessType: string
  currency: string
  /** ZiG per $1 USD; amounts in DB are USD cents */
  zigRatePerUsd?: number
  supabaseId?: string
  createdAt: number
  recoveryEmail?: string
  recoveryEmailVerified: boolean
}

export interface Product {
  id: string
  businessId: string
  name: string
  category?: string
  unit: string
  costPriceCents: number
  sellingPriceCents: number
  stockQty: number
  lowStockThreshold: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface Sale {
  id: string
  businessId: string
  totalCents: number
  discountCents: number
  paymentMethod: PaymentMethod
  note?: string
  receiptNumber: string
  createdAt: number
}

export interface SaleItem {
  id: string
  saleId: string
  productId: string
  productNameSnapshot: string
  qty: number
  unitPriceCents: number
  costPriceCents: number
}

export interface StockMovement {
  id: string
  businessId: string
  productId: string
  productNameSnapshot: string
  action: StockAction
  qtyChange: number
  reason?: string
  supplier?: string
  createdAt: number
}

export interface Customer {
  id: string
  businessId: string
  name: string
  phone?: string
  outstandingBalanceCents: number
  isActive?: boolean
  createdAt: number
}

export interface CreditSale {
  id: string
  saleId: string
  customerId: string
  amountCents: number
  amountPaidCents: number
  isSettled: boolean
  createdAt: number
}

export interface PaymentRecord {
  id: string
  customerId: string
  amountCents: number
  paymentMethod: string
  notes?: string
  createdAt: number
}

export type PaymentMethod = 'cash_usd' | 'cash_zig' | 'ecocash' | 'bank_transfer' | 'credit'

export type StockAction = 'sale' | 'purchase' | 'adjustment'

export type AdjustmentReason = 'damaged' | 'theft' | 'expired' | 'correction'

export interface CartItem {
  productId: string
  productName: string
  qty: number
  unitPriceCents: number
  costPriceCents: number
}

export interface DashboardMetrics {
  todaysSalesCents: number
  totalStockValueCents: number
  monthProfitCents: number
  outstandingCreditCents: number
  lowStockCount: number
}
