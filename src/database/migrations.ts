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
  ],
})
