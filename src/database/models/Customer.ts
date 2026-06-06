import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class Customer extends Model {
  static table = 'customers'

  @field('business_id') businessId!: string
  @field('name') name!: string
  @field('phone') phone!: string | null
  @field('national_id') nationalId!: string | null
  @field('outstanding_balance_cents') outstandingBalanceCents!: number
  @field('is_active') isActive!: boolean | null
  @field('supabase_id') supabaseId!: string | null
  @readonly @date('created_at') createdAt!: Date
  @date('updated_at') updatedAt!: Date
}
