import { Model } from '@nozbe/watermelondb'
import { date, field, readonly } from '@nozbe/watermelondb/decorators'

export default class Shopkeeper extends Model {
  static table = 'shopkeepers'

  @field('business_id') businessId!: string
  @field('supabase_id') supabaseId!: string
  @field('username') username!: string
  @field('full_name') fullName!: string
  /** Uppercase receipt suffix; unique per business */
  @field('receipt_suffix') receiptSuffix!: string | null
  @field('phone') phone!: string | null
  @field('shop_id') shopId!: string | null
  @field('is_active') isActive!: boolean
  @readonly @date('created_at') createdAt!: Date
  @date('updated_at') updatedAt!: Date
}
