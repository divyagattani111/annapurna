-- Promote salesmen JSONB details to typed columns
ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS itc_id text;
ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS beat_code text;
ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS beat_name text;
ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS route text;

-- Backfill typed columns from JSONB details
UPDATE salesmen
SET itc_id    = details->>'itc_id',
    beat_code = details->>'beat_code',
    beat_name = details->>'beat_name',
    route     = details->>'route'
WHERE (details->>'itc_id' IS NOT NULL
    OR details->>'beat_code' IS NOT NULL
    OR details->>'beat_name' IS NOT NULL
    OR details->>'route' IS NOT NULL);

-- Add customer_id FK on documents (nullable)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS customer_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'documents_customer_id_fk'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_customer_id_fk
      FOREIGN KEY (customer_id) REFERENCES itc_customers(id);
  END IF;
END $$;

-- Backfill customer_id and return_line_id from JSON data
ALTER TABLE documents DISABLE TRIGGER documents_immutable;

UPDATE documents d
SET customer_id = c.id
FROM itc_customers c
WHERE d.customer_id IS NULL
  AND d.org = c.org
  AND d.data->>'customerId' IS NOT NULL
  AND d.data->>'customerId' != ''
  AND (c.id::text = d.data->>'customerId' OR c.customer_id = d.data->>'customerId');

-- Add return_line_id FK on documents (nullable)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS return_line_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'documents_return_line_id_fk'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_return_line_id_fk
      FOREIGN KEY (return_line_id) REFERENCES bill_lines(id);
  END IF;
END $$;

-- Backfill return_line_id from JSON data->>'lineId'
UPDATE documents d
SET return_line_id = bl.id
FROM bill_lines bl
WHERE d.return_line_id IS NULL
  AND d.kind = 'return'
  AND d.data->>'lineId' IS NOT NULL
  AND bl.id::text = d.data->>'lineId'
  AND bl.org = d.org;

ALTER TABLE documents ENABLE TRIGGER documents_immutable;

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create foods_salesmen table
CREATE TABLE IF NOT EXISTS foods_salesmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  territory text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create product_pack_pcs table
CREATE TABLE IF NOT EXISTS product_pack_pcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org uuid NOT NULL REFERENCES organizations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  pcs_per_pack integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_pcs_product UNIQUE (org, product_id)
);

-- Sync itc_customers from current salesmen master (fix stale data NOW, protect multi-beat customers)
UPDATE itc_customers c
SET   salesman_name   = s.name,
      salesman_itc_id = COALESCE(NULLIF(s.itc_id, ''), NULLIF(s.details->>'itc_id', ''), c.salesman_itc_id),
      beat_code       = CASE 
                          WHEN COALESCE(s.route, s.details->>'route', '') = 'Wholesale' THEN c.beat_code 
                          ELSE COALESCE(NULLIF(s.beat_code, ''), NULLIF(s.details->>'beat_code', ''), c.beat_code)
                        END,
      beat_name       = CASE 
                          WHEN COALESCE(s.route, s.details->>'route', '') = 'Wholesale' THEN c.beat_name 
                          ELSE COALESCE(NULLIF(s.beat_name, ''), NULLIF(s.details->>'beat_name', ''), c.beat_name)
                        END
FROM  salesmen s
WHERE s.id = c.salesman_id AND s.org = c.org;
