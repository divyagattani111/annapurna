CREATE TABLE IF NOT EXISTS itc_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org uuid NOT NULL REFERENCES organizations(id),
  customer_id text NOT NULL,
  customer_name text NOT NULL,
  salesman_itc_id text NOT NULL,
  salesman_name text NOT NULL,
  beat_code text NOT NULL,
  beat_name text NOT NULL,
  salesman_id uuid REFERENCES salesmen(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS itc_customer_id_org ON itc_customers(org, customer_id);
CREATE INDEX IF NOT EXISTS itc_customers_salesman_idx ON itc_customers(org, salesman_id);

