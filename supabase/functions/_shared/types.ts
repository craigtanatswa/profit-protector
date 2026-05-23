export type PaymentMethod = 'ecocash' | 'onemoney' | 'innbucks' | 'card' | 'zimswitch' | 'vmc'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'expired'
  | 'grace'
  | 'cancelled'

export interface InitiateRequest {
  businessId: string
  paymentMethod: PaymentMethod
  phoneNumber?: string
  authEmail?: string
  amount?: number
}

export interface PaynowFields {
  [key: string]: string
}

/**
 * Returned by paynow-initiate. Contains all server-signed parameters the
 * client should POST directly to Paynow, plus the target URL. The
 * Integration Key is never included — only the pre-computed hash.
 */
export interface SignedPaymentResponse {
  success: boolean
  paymentId: string
  reference: string
  submitUrl: string
  submitParams: Record<string, string>
  paymentMethod: PaymentMethod
}
