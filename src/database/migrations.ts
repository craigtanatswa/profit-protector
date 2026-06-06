import { addColumns, createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'businesses',
          columns: [{ name: 'login_username', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'customers',
          columns: [{ name: 'updated_at', type: 'number' }],
        }),
        addColumns({
          table: 'credit_sales',
          columns: [{ name: 'updated_at', type: 'number' }],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'customers',
          columns: [{ name: 'is_active', type: 'boolean', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        createTable({
          name: 'payment_records',
          columns: [
            { name: 'customer_id', type: 'string', isIndexed: true },
            { name: 'amount_cents', type: 'number' },
            { name: 'payment_method', type: 'string' },
            { name: 'notes', type: 'string', isOptional: true },
            { name: 'supabase_id', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'businesses',
          columns: [{ name: 'zig_rate_per_usd', type: 'number', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'businesses',
          columns: [
            { name: 'recovery_email', type: 'string', isOptional: true },
            { name: 'recovery_email_verified', type: 'boolean' },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        addColumns({
          table: 'businesses',
          columns: [{ name: 'public_id', type: 'string', isOptional: true }],
        }),
        createTable({
          name: 'shopkeepers',
          columns: [
            { name: 'business_id', type: 'string', isIndexed: true },
            { name: 'supabase_id', type: 'string' },
            { name: 'username', type: 'string' },
            { name: 'full_name', type: 'string' },
            { name: 'phone', type: 'string', isOptional: true },
            { name: 'is_active', type: 'boolean' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'activity_logs',
          columns: [
            { name: 'business_id', type: 'string', isIndexed: true },
            { name: 'actor_id', type: 'string' },
            { name: 'actor_name', type: 'string' },
            { name: 'actor_role', type: 'string' },
            { name: 'action', type: 'string' },
            { name: 'entity_type', type: 'string' },
            { name: 'entity_id', type: 'string', isOptional: true },
            { name: 'entity_name', type: 'string', isOptional: true },
            { name: 'details', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 9,
      steps: [
        addColumns({
          table: 'sales',
          columns: [
            { name: 'created_by_shopkeeper_id', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 10,
      steps: [
        addColumns({
          table: 'shopkeepers',
          columns: [{ name: 'receipt_suffix', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 11,
      steps: [
        addColumns({
          table: 'customers',
          columns: [{ name: 'national_id', type: 'string', isOptional: true }],
        }),
      ],
    },
  ],
})
