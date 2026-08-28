import { Model } from '@nozbe/watermelondb'
import { date, field, readonly } from '@nozbe/watermelondb/decorators'

export default class Shop extends Model {
  static table = 'shops'

  @field('business_id') businessId!: string
  @field('name') name!: string
  @field('address') address!: string
  @field('shop_number') shopNumber!: number
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date
  @date('updated_at') updatedAt!: Date
}
