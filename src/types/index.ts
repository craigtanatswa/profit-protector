export interface Business {
  id: string
  name: string
  ownerName: string
  /** Optional billing / Paynow checkout email separate from recovery email */
  ownerEmail?: string
  phone: string
  businessType: string
  currency: string
  publicId?: string
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
  /** Present when the sale was recorded by a shopkeeper staff login */
  createdByShopkeeperId?: string | null
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
  nationalId?: string
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

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'grace' | 'cancelled'

export interface Subscription {
  id: string
  businessId: string
  status: SubscriptionStatus
  /** Which paid plan the business is on. Defaults to 'pro' for legacy rows. */
  planTier: 'pro' | 'pro_plus'
  trialStart: string
  trialEnd: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  lastPaymentAt: string | null
  lastPaymentAmountCents: number | null
  nextBillingDate: string | null
  paymentMethod: string | null
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id: string
  businessId: string
  subscriptionId: string
  paynowReference: string | null
  paynowPollUrl: string | null
  amountCents: number
  currency: string
  paymentMethod: string
  phoneNumber: string | null
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  paynowStatus: string | null
  planTier: 'pro' | 'pro_plus'
  isUpgrade: boolean
  createdAt: string
}

export interface InitiatePaymentResult {
  success: boolean
  paymentId?: string
  pollUrl?: string
  redirectUrl?: string
  paymentMethod?: string
  instructions?: string
  authorizationCode?: string
  authorizationExpires?: string
  deepLink?: string
  message?: string
  /** True when the server applied a mid-cycle upgrade at no charge (proration < $0.50). */
  freeUpgrade?: boolean
  /** The prorated amount charged in cents (only set for upgrade flows). */
  chargeCents?: number
}

export interface PollResult {
  status: string
  isPaid: boolean
}

export type StockAction = 'sale' | 'purchase' | 'adjustment'

export type AdjustmentReason = 'damaged' | 'theft' | 'expired' | 'correction'

export type UserRole = 'owner' | 'shopkeeper'

export interface Shopkeeper {
  id: string
  businessId: string
  supabaseId: string
  username: string
  fullName: string
  phone?: string
  /** Unique per business; appended to auto receipt numbers for this staff member */
  receiptSuffix: string
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface ShopkeeperSession {
  shopkeeper: Shopkeeper
  businessId: string
  businessName: string
  deviceId: string
  isApproved: boolean
  sessionToken: string
}

export type ActivityAction =
  | 'sale_completed'
  | 'sale_voided'
  | 'product_added'
  | 'product_edited'
  | 'product_deactivated'
  | 'stock_received'
  | 'stock_adjusted'
  | 'customer_added'
  | 'customer_edited'
  | 'customer_deleted'
  | 'payment_recorded'
  | 'shopkeeper_added'
  | 'shopkeeper_deactivated'
  | 'shopkeeper_deleted'
  | 'shopkeeper_password_changed'
  | 'device_approved'
  | 'device_denied'
  | 'stock_access_approved'
  | 'stock_access_denied'
  | 'business_profile_updated'
  | 'password_changed'
  | 'data_exported'
  | 'data_synced'
  | 'account_login_owner'
  | 'account_login_shopkeeper'
  | 'account_logout'

export type EntityType =
  | 'sale'
  | 'product'
  | 'customer'
  | 'shopkeeper'
  | 'business'
  | 'report'
  | 'account'
  | 'stock_movement'
  | 'device'

export interface ActivityLog {
  id: string
  businessId: string
  actorId: string
  actorName: string
  actorRole: UserRole
  action: ActivityAction
  entityType: EntityType
  entityId?: string
  entityName?: string
  details?: Record<string, unknown>
  createdAt: number
}

export interface DeviceApprovalRequest {
  id: string
  shopkeeperId: string
  businessId: string
  shopkeeperName: string
  deviceId: string
  deviceName: string
  status: 'pending' | 'approved' | 'denied'
  requestedAt: string
}

/** Owner approval scope: receive/add stock vs adjust stock (separate 24h grants). */
export type StockAccessType = 'receive' | 'adjust'

export interface StockAccessApprovalRequest {
  id: string
  shopkeeperId: string
  businessId: string
  shopkeeperName: string
  accessType: StockAccessType
  status: 'pending' | 'approved' | 'denied'
  requestedAt: string
}

export type ShopkeeperStockAccessStatus =
  | 'granted'
  | 'pending'
  | 'denied'
  | 'none'

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
