-- Full setup: table + indexes + RLS (run this if payment_records does not exist yet).
-- businesses link to auth via user_id (see app/(auth)/register.tsx).

-- 1. Table
CREATE TABLE IF NOT EXISTS payment_records (
  id             text        PRIMARY KEY,
  customer_id    text        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  amount_cents   integer     NOT NULL CHECK (amount_cents > 0),
  payment_method text        NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_records_customer_id_idx
  ON payment_records (customer_id);

CREATE INDEX IF NOT EXISTS payment_records_created_at_idx
  ON payment_records (created_at);

-- 2. RLS
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Access own business payment_records" ON payment_records;

CREATE POLICY "Access own business payment_records"
  ON payment_records
  FOR ALL
  USING (
    customer_id IN (
      SELECT c.id
      FROM customers c
      INNER JOIN businesses b ON b.id = c.business_id
      WHERE b.user_id = auth.uid()
    )
  );
