ALTER TABLE receipt_claims DROP CONSTRAINT IF EXISTS claim_status;
ALTER TABLE receipt_claims ADD CONSTRAINT claim_status CHECK(state IN ('pending','confirmed','rejected','reversed'));
ALTER TABLE receipt_claims DROP CONSTRAINT IF EXISTS confirmed_document;
ALTER TABLE receipt_claims ADD CONSTRAINT confirmed_document CHECK(((state IN ('confirmed','reversed')) = (document_id IS NOT NULL)));

