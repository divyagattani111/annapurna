CREATE TABLE IF NOT EXISTS cash_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org uuid NOT NULL REFERENCES organizations(id),
  salesman_id uuid NOT NULL REFERENCES salesmen(id),
  amount numeric(18, 2) NOT NULL,
  accepted_amount numeric(18, 2),
  date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  salesman_note text,
  manager_note text,
  document_id uuid REFERENCES documents(id),
  actor text NOT NULL REFERENCES "user"(id),
  verified_by text REFERENCES "user"(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  verified_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS cash_handovers_org_status_idx ON cash_handovers(org, status);
CREATE INDEX IF NOT EXISTS cash_handovers_salesman_idx ON cash_handovers(org, salesman_id, date);

