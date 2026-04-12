import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class CreditSale extends Model {
  static table = 'credit_sales'

  @field('sale_id') saleId!: string
  @field('customer_id') customerId!: string
  @field('amount_cents') amountCents!: number
  @field('amount_paid_cents') amountPaidCents!: number
  @field('is_settled') isSettled!: boolean
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date
}
