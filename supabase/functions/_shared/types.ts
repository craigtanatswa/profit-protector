export type PaymentMethod = 'ecocash' | 'onemoney' | 'innbucks' | 'card' | 'zimswitch' | 'vmc'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'expired'
  | 'grace'
  | 'cancelled'

export type PlanTier = 'pro' | 'pro_plus'

export interface InitiateRequest {
  businessId: string
  paymentMethod: PaymentMethod
  phoneNumber?: string
  authEmail?: string
  amount?: number
  /** Which plan tier the user is subscribing to. Defaults to 'pro'. */
  planTier?: PlanTier
  /**
   * When true, this is a mid-cycle upgrade from Pro → Pro+.
   * The server computes the prorated charge and ignores any client-provided `amount`.
   * If the prorated charge is < $0.50, the upgrade is applied immediately at no charge.
   * paymentMethod is optional for the free-upgrade path.
   */
  isUpgrade?: boolean
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
