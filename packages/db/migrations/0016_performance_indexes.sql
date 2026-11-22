-- Migration 0016: Performance Indexes on Foreign Keys and High-Frequency Query Paths

-- 1. documents FK & query indexes
CREATE INDEX IF NOT EXISTS documents_customer_id_idx ON documents (org, customer_id);
CREATE INDEX IF NOT EXISTS documents_return_line_id_idx ON documents (org, return_line_id);
CREATE INDEX IF NOT EXISTS documents_kind_date_idx ON documents (org, kind, business_date);

-- 2. itc_customers salesman FK index
CREATE INDEX IF NOT EXISTS itc_customers_salesman_idx ON itc_customers (org, salesman_id);

-- 3. product_configurations lookup index
CREATE INDEX IF NOT EXISTS product_config_prod_date_idx ON product_configurations (org, product_id, effective_date DESC);

-- 4. allocations FK indexes
CREATE INDEX IF NOT EXISTS allocations_charge_idx ON allocations (org, charge_id);
CREATE INDEX IF NOT EXISTS allocations_credit_idx ON allocations (org, credit_id);

-- 5. receipt_claims FK indexes
CREATE INDEX IF NOT EXISTS receipt_claims_salesman_idx ON receipt_claims (org, salesman_id);
CREATE INDEX IF NOT EXISTS receipt_claims_document_idx ON receipt_claims (org, document_id);

-- 6. cash_handovers FK indexes
CREATE INDEX IF NOT EXISTS cash_handovers_salesman_idx ON cash_handovers (org, salesman_id);
CREATE INDEX IF NOT EXISTS cash_handovers_document_idx ON cash_handovers (org, document_id);

-- 7. employees & foods_salesmen active lookups
CREATE INDEX IF NOT EXISTS employees_org_active_idx ON employees (org, active);
CREATE INDEX IF NOT EXISTS foods_salesmen_org_active_idx ON foods_salesmen (org, active);

