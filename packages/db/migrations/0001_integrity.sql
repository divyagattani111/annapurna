-- Reviewed integrity extensions. Additive only; no data reset or destructive DDL.
CREATE SEQUENCE document_numbers;
ALTER TABLE organizations ADD CONSTRAINT organization_mode CHECK(mode IN ('demo','test','live'));
ALTER TABLE members ADD CONSTRAINT member_role CHECK(role IN ('owner','manager'));
ALTER TABLE money_accounts ADD CONSTRAINT money_type CHECK(type IN ('cash','bank'));
ALTER TABLE money_accounts ADD CONSTRAINT physical_no_overdraft CHECK(type<>'cash' OR NOT allow_overdraft);
ALTER TABLE documents ADD CONSTRAINT positive_document CHECK(amount>0);
ALTER TABLE journal ADD CONSTRAINT one_journal_side CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0));
ALTER TABLE allocations ADD CONSTRAINT positive_application CHECK(amount>0);
ALTER TABLE bill_lines ADD CONSTRAINT positive_line CHECK(quantity>0 AND amount>=0);
ALTER TABLE product_configurations ADD CONSTRAINT valid_config CHECK(conversion>0 AND basis>0 AND rate>=0);
ALTER TABLE receipt_claims ADD CONSTRAINT claim_status CHECK(state IN ('pending','confirmed','rejected'));
ALTER TABLE receipt_claims ADD CONSTRAINT positive_claim CHECK(amount>0);
ALTER TABLE receipt_claims ADD CONSTRAINT confirmed_document CHECK((state='confirmed')=(document_id IS NOT NULL));
CREATE INDEX journal_account ON journal(org,account,document_id);
CREATE INDEX document_date ON documents(org,business_date,created_at);
CREATE INDEX doc_salesman ON documents(org,salesman_id,business_date);
CREATE INDEX applications_generation ON allocations(org,salesman_id,generation);
ALTER TABLE salesmen ADD CONSTRAINT salesmen_org_id UNIQUE(org,id);
ALTER TABLE products ADD CONSTRAINT products_org_id UNIQUE(org,id);
ALTER TABLE money_accounts ADD CONSTRAINT money_accounts_org_id UNIQUE(org,id);
ALTER TABLE documents ADD CONSTRAINT documents_org_id UNIQUE(org,id);
ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_org_id UNIQUE(org,id);
ALTER TABLE receipt_claims ADD CONSTRAINT receipt_claims_org_id UNIQUE(org,id);
ALTER TABLE documents ADD CONSTRAINT documents_salesman_id_scope FOREIGN KEY(org,salesman_id) REFERENCES salesmen(org,id);
ALTER TABLE documents ADD CONSTRAINT documents_reverses_scope FOREIGN KEY(org,reverses) REFERENCES documents(org,id);
ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_document_id_scope FOREIGN KEY(org,document_id) REFERENCES documents(org,id);
ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_product_id_scope FOREIGN KEY(org,product_id) REFERENCES products(org,id);
ALTER TABLE journal ADD CONSTRAINT journal_document_id_scope FOREIGN KEY(org,document_id) REFERENCES documents(org,id);
ALTER TABLE product_configurations ADD CONSTRAINT product_configurations_product_id_scope FOREIGN KEY(org,product_id) REFERENCES products(org,id);
ALTER TABLE receipt_claims ADD CONSTRAINT receipt_claims_salesman_id_scope FOREIGN KEY(org,salesman_id) REFERENCES salesmen(org,id);
ALTER TABLE receipt_claims ADD CONSTRAINT receipt_claims_account_id_scope FOREIGN KEY(org,account_id) REFERENCES money_accounts(org,id);
ALTER TABLE receipt_claims ADD CONSTRAINT receipt_claims_document_id_scope FOREIGN KEY(org,document_id) REFERENCES documents(org,id);
ALTER TABLE bank_identities ADD CONSTRAINT bank_identities_account_id_scope FOREIGN KEY(org,account_id) REFERENCES money_accounts(org,id);
ALTER TABLE bank_identities ADD CONSTRAINT bank_identities_document_id_scope FOREIGN KEY(org,document_id) REFERENCES documents(org,id);
ALTER TABLE allocations ADD CONSTRAINT allocations_salesman_id_scope FOREIGN KEY(org,salesman_id) REFERENCES salesmen(org,id);
ALTER TABLE allocations ADD CONSTRAINT allocations_credit_id_scope FOREIGN KEY(org,credit_id) REFERENCES documents(org,id);
ALTER TABLE allocations ADD CONSTRAINT allocations_charge_id_scope FOREIGN KEY(org,charge_id) REFERENCES documents(org,id);
ALTER TABLE allocation_heads ADD CONSTRAINT allocation_heads_salesman_id_scope FOREIGN KEY(org,salesman_id) REFERENCES salesmen(org,id);
ALTER TABLE closes ADD CONSTRAINT closes_account_id_scope FOREIGN KEY(org,account_id) REFERENCES money_accounts(org,id);
ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_account_id_scope FOREIGN KEY(org,account_id) REFERENCES money_accounts(org,id);
ALTER TABLE attachments ADD CONSTRAINT attachments_document_id_scope FOREIGN KEY(org,document_id) REFERENCES documents(org,id);

CREATE FUNCTION immutable_financial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted financial history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER documents_immutable BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER bill_lines_immutable BEFORE UPDATE OR DELETE ON bill_lines FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER allocations_immutable BEFORE UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER bank_identities_immutable BEFORE UPDATE OR DELETE ON bank_identities FOR EACH ROW EXECUTE FUNCTION immutable_financial();
CREATE TRIGGER product_configurations_immutable BEFORE UPDATE OR DELETE ON product_configurations FOR EACH ROW EXECUTE FUNCTION immutable_financial();

CREATE FUNCTION check_entry_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id uuid; total numeric; lines integer;
BEGIN
 entry_id := CASE WHEN TG_TABLE_NAME='documents' THEN NEW.id ELSE NEW.document_id END;
 SELECT coalesce(sum(debit-credit),0),count(*) INTO total,lines FROM journal WHERE document_id=entry_id;
 IF total<>0 OR lines<2 THEN RAISE EXCEPTION 'Entry must balance and have at least two lines' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER document_balanced AFTER INSERT ON documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balance();
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balance();
CREATE FUNCTION journal_dimension_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account LIKE 'trade:%' AND NOT EXISTS(SELECT 1 FROM salesmen WHERE org=NEW.org AND 'trade:'||id::text=NEW.account) THEN RAISE EXCEPTION 'Invalid trade dimension' USING ERRCODE='23514'; END IF;
 IF NEW.account LIKE 'money:%' AND NOT EXISTS(SELECT 1 FROM money_accounts WHERE org=NEW.org AND 'money:'||id::text=NEW.account) THEN RAISE EXCEPTION 'Invalid money dimension' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_dimensions BEFORE INSERT ON journal FOR EACH ROW EXECUTE FUNCTION journal_dimension_scope();
