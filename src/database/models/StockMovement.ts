import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class StockMovement extends Model {
  static table = 'stock_movements'

  @field('business_id') businessId!: string
  @field('product_id') productId!: string
  @field('product_name_snapshot') productNameSnapshot!: string
  @field('action') action!: string
  @field('qty_change') qtyChange!: number
  @field('reason') reason!: string | null
  @field('supplier') supplier!: string | null
  @readonly @date('created_at') createdAt!: Date
}
