import { addColumns, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

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
  ],
})
