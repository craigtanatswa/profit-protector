import { Model } from '@nozbe/watermelondb'
import { field, relation } from '@nozbe/watermelondb/decorators'
import type { Relation } from '@nozbe/watermelondb'
import type Sale from './Sale'

export default class SaleItem extends Model {
  static table = 'sale_items'

  static associations = {
    sales: { type: 'belongs_to' as const, key: 'sale_id' },
  }

  @field('sale_id') saleId!: string
  @field('product_id') productId!: string
  @field('product_name_snapshot') productNameSnapshot!: string
  @field('qty') qty!: number
  @field('unit_price_cents') unitPriceCents!: number
  @field('cost_price_cents') costPriceCents!: number

  @relation('sales', 'sale_id') sale!: Relation<Sale>
}
