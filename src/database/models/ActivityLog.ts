import { Model } from '@nozbe/watermelondb'
import { date, field, readonly } from '@nozbe/watermelondb/decorators'

export default class ActivityLog extends Model {
  static table = 'activity_logs'

  @field('business_id') businessId!: string
  @field('actor_id') actorId!: string
  @field('actor_name') actorName!: string
  @field('actor_role') actorRole!: string
  @field('action') action!: string
  @field('entity_type') entityType!: string
  @field('entity_id') entityId!: string | null
  @field('entity_name') entityName!: string | null
  @field('details') details!: string | null
  @readonly @date('created_at') createdAt!: Date
}
