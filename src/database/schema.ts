import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const schema = appSchema({
  version: 8,
  tables: [
    tableSchema({
      name: 'businesses',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'owner_name', type: 'string' },
        { name: 'phone', type: 'string' },
        { name: 'business_type', type: 'string' },
        { name: 'currency', type: 'string' },
        { name: 'zig_rate_per_usd', type: 'number', isOptional: true },
        { name: 'login_username', type: 'string', isOptional: true },
        { name: 'public_id', type: 'string', isOptional: true },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'recovery_email', type: 'string', isOptional: true },
        { name: 'recovery_email_verified', type: 'boolean' },
        { name: 'created_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'products',
      columns: [
        { name: 'business_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'category', type: 'string', isOptional: true },
        { name: 'unit', type: 'string' },
        { name: 'cost_price_cents', type: 'number' },
        { name: 'selling_price_cents', type: 'number' },
        { name: 'stock_qty', type: 'number' },
        { name: 'low_stock_threshold', type: 'number' },
        { name: 'is_active', type: 'boolean' },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'sales',
      columns: [
        { name: 'business_id', type: 'string', isIndexed: true },
        { name: 'total_cents', type: 'number' },
        { name: 'discount_cents', type: 'number' },
        { name: 'payment_method', type: 'string' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'receipt_number', type: 'string' },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'sale_items',
      columns: [
        { name: 'sale_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string' },
        { name: 'product_name_snapshot', type: 'string' },
        { name: 'qty', type: 'number' },
        { name: 'unit_price_cents', type: 'number' },
        { name: 'cost_price_cents', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'stock_movements',
      columns: [
        { name: 'business_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'product_name_snapshot', type: 'string' },
        { name: 'action', type: 'string' },
        { name: 'qty_change', type: 'number' },
        { name: 'reason', type: 'string', isOptional: true },
        { name: 'supplier', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'customers',
      columns: [
        { name: 'business_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'phone', type: 'string', isOptional: true },
        { name: 'outstanding_balance_cents', type: 'number' },
        { name: 'is_active', type: 'boolean', isOptional: true },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'payment_records',
      columns: [
        { name: 'customer_id', type: 'string', isIndexed: true },
        { name: 'amount_cents', type: 'number' },
        { name: 'payment_method', type: 'string' },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ]
    }),
    tableSchema({
      name: 'credit_sales',
      columns: [
        { name: 'sale_id', type: 'string' },
        { name: 'customer_id', type: 'string', isIndexed: true },
        { name: 'amount_cents', type: 'number' },
        { name: 'amount_paid_cents', type: 'number' },
        { name: 'is_settled', type: 'boolean' },
        { name: 'supabase_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ]
    }),
    tableSchema({
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
      ]
    }),
    tableSchema({
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
      ]
    }),
  ]
})
