import { Model } from '@nozbe/watermelondb'
import { field, readonly, date } from '@nozbe/watermelondb/decorators'

export default class Business extends Model {
  static table = 'businesses'

  @field('name') name!: string
  @field('owner_name') ownerName!: string
  @field('phone') phone!: string
  @field('business_type') businessType!: string
  @field('currency') currency!: string
  @field('zig_rate_per_usd') zigRatePerUsd!: number | null
  @field('login_username') loginUsername!: string | null
  @field('supabase_id') supabaseId!: string | null
  @field('recovery_email') recoveryEmail!: string | null
  @field('recovery_email_verified') recoveryEmailVerified!: boolean
  @readonly @date('created_at') createdAt!: Date
}
