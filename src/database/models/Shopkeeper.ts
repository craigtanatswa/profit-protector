import { Model } from '@nozbe/watermelondb'
import { date, field, readonly } from '@nozbe/watermelondb/decorators'

export default class Shopkeeper extends Model {
  static table = 'shopkeepers'

  @field('business_id') businessId!: string
  @field('supabase_id') supabaseId!: string
  @field('username') username!: string
  @field('full_name') fullName!: string
  @field('phone') phone!: string | null
  @field('is_active') isActive!: boolean
  @readonly @date('created_at') createdAt!: Date
  @date('updated_at') updatedAt!: Date
}
