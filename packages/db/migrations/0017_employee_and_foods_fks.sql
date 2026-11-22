-- Migration 0017: Add employee_id and foods_salesman_id Foreign Keys and Indexes on documents

ALTER TABLE documents ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS foods_salesman_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'documents_employee_id_fk'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_employee_id_fk
      FOREIGN KEY (employee_id) REFERENCES employees(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'documents_foods_salesman_id_fk'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_foods_salesman_id_fk
      FOREIGN KEY (foods_salesman_id) REFERENCES foods_salesmen(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_employee_id_idx ON documents (org, employee_id);
CREATE INDEX IF NOT EXISTS documents_foods_salesman_id_idx ON documents (org, foods_salesman_id);

