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
  ],
})
