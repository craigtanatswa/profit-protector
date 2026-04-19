import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class PaymentRecord extends Model {
  static table = 'payment_records'

  @field('customer_id') customerId!: string
  @field('amount_cents') amountCents!: number
  @field('payment_method') paymentMethod!: string
  @field('notes') notes!: string | null
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date
}
