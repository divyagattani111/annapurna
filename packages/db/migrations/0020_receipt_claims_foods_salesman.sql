-- Migration 0020: Allow receipt_claims for foods_salesmen
ALTER TABLE receipt_claims ALTER COLUMN salesman_id DROP NOT NULL;
ALTER TABLE receipt_claims ADD COLUMN IF NOT EXISTS foods_salesman_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'receipt_claims_foods_salesman_id_fk'
  ) THEN
    ALTER TABLE receipt_claims ADD CONSTRAINT receipt_claims_foods_salesman_id_fk
      FOREIGN KEY (foods_salesman_id) REFERENCES foods_salesmen(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS receipt_claims_foods_salesman_idx ON receipt_claims (org, foods_salesman_id);
