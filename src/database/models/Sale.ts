import { Model } from '@nozbe/watermelondb'
import { field, readonly, date, children } from '@nozbe/watermelondb/decorators'
import type { Query } from '@nozbe/watermelondb'
import type SaleItem from './SaleItem'

export default class Sale extends Model {
  static table = 'sales'

  static associations = {
    sale_items: { type: 'has_many' as const, foreignKey: 'sale_id' },
  }

  @field('business_id') businessId!: string
  @field('total_cents') totalCents!: number
  @field('discount_cents') discountCents!: number
  @field('payment_method') paymentMethod!: string
  @field('note') note!: string | null
  @field('receipt_number') receiptNumber!: string
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date

  @children('sale_items') items!: Query<SaleItem>
}
