-- Run by the migration administrator after reviewed migrations, never by the web API.
GRANT USAGE ON SCHEMA public TO ledger_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ledger_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
GRANT INSERT ON organizations,members,salesmen,products,product_configurations,money_accounts,documents,bill_lines,journal,receipt_claims,bank_identities,allocations,allocation_heads,audit,idempotency,closes,periods,reconciliations,drafts,attachments,requests,"user",session,account,verification TO ledger_app;
GRANT UPDATE ON members,salesmen,products,money_accounts,allocation_heads,receipt_claims,periods,drafts,requests,"user",session,account,verification TO ledger_app;
GRANT UPDATE(name,setup) ON organizations TO ledger_app;
GRANT UPDATE(state) ON closes,reconciliations TO ledger_app;
GRANT DELETE ON session,verification,drafts TO ledger_app;
-- No UPDATE/DELETE privilege on posted documents, journal, bill lines, applications,
-- audit, bank identities, price versions or idempotency history. No schema ownership.
