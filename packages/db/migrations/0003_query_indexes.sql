-- Supporting indexes for deferred journal checks, statement/document lookup and private records.
CREATE INDEX journal_document ON journal(document_id);
CREATE INDEX bill_lines_document ON bill_lines(org,document_id);
CREATE INDEX claims_queue ON receipt_claims(org,state,created_at);
CREATE INDEX attachments_document ON attachments(org,document_id);
CREATE INDEX audit_order ON audit(org,created_at);
CREATE INDEX config_effective ON product_configurations(org,product_id,effective_date,created_at);
