import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class Product extends Model {
  static table = 'products'

  @field('business_id') businessId!: string
  @field('name') name!: string
  @field('category') category!: string | null
  @field('unit') unit!: string
  @field('tracking_mode') trackingMode!: string | null
  @field('cost_price_cents') costPriceCents!: number
  @field('selling_price_cents') sellingPriceCents!: number
  @field('stock_qty') stockQty!: number
  @field('low_stock_threshold') lowStockThreshold!: number
  @field('is_active') isActive!: boolean
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date
  @date('updated_at') updatedAt!: Date
}
