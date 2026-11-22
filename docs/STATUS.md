# Implementation status — 7 November 2026

New Bill has a simplified salesman/date header and six-column editable pricing grid. Per-bill rate/basis and fixed/percentage discounts are calculated on the server, preserved in drafts, permission-checked and snapshotted for printing/returns. Owner-controlled manager capabilities or frozen owner approval govern edits. No schema migration or live-data change was needed. See TEST_RESULTS.md for the new validation and pricing coverage.

Dashboard and sidebar destinations now agree. New bill, daily close and all other former modal workflows use full-page views inside the main workspace. Payment, expense and deposit shortcuts open the corresponding sidebar sections. Back navigation and active sidebar state are provided; navigation is disabled during an in-flight posting. See MANAGER_GUIDE.md for the updated flow.

All six implementation stages in PLAN.md have a working implementation. This is a local development build with fictional data, not a signed-off live accounting installation. The entire CODEX_APP_CONTEXT.md remains the source specification; the 55 cases and evidence boundaries are recorded in ACCEPTANCE.md.

## Available workflows

- Bun/Turborepo TypeScript workspace; Hono API under `/api/v1`; PostgreSQL 18 persistence; Drizzle schema and six reviewed, additive SQL migrations (0000–0005); shared strict Zod contracts.
- Database sessions, owner/manager permissions checked on the server, private evidence, same-origin mutation protection, actor-scoped drafts, audit and owner approval requests.
- Exact decimal bills and versioned unit/rate snapshots, child receipts, pending/rejected/verified online claims, bank-credit identities, overpayments, allocations, linked returns, refunds and immutable corrections.
- Physical and owner-held cash books, bank/transit deposits including partial resolutions, transfers, unidentified credits and split assignment, loans in both directions, staff advances/salary setoff, expenses and owner funding/withdrawals.
- Cash count/close, explicit unresolved differences, owner resolution/reopen, stale later closes/reconciliations, opening-total import preview and atomic posting.
- Searchable registers, khata statements, numeric reports, ECharts, displayed-page CSV export, issue-time bill reprints, multipage printing, permission management and live setup checklist.
- Atomic source/journal/allocation/audit/idempotency changes; organization-level financial serialization; balanced-entry and immutability database guards. Runtime deployment uses a restricted database role separate from migration administration.
- VPS Compose/Caddy configuration, operations image, private backup tooling and non-destructive isolated restore drill. Deployment and off-server scheduling are documented but have not been enabled.

## Stitch references

On 7 November, the owner supplied a warm orange dashboard screenshot as a newer visual direction. The dashboard and shared navigation now follow that orange/amber palette, white/stone cards, daily metric colors and cash/queue layout. The five Stitch exports remain the base references for the other workflows. No financial rule or persisted data was changed for this restyling.

Reviewed the five exported PNG screens, accompanying HTML and `sales_money_book/DESIGN.md` in `stitch_sales_money_book_pwa/`: dashboard, new bill, salesman khata, receive money, and other money. The UI uses their blue/slate palette, sidebar/action layout, numbered bill steps and two-pane khata as base models. Business labels, states and calculations follow the specification. Sample identities, prices, inventory assumptions and bank details were not imported.

## Boundaries and remaining live work

Confirm real product units/rates/conversions, identities, account custody, cutover and signed opening balances before creating an independently provisioned live business. A demo/test business is not converted into live data. Owner setup approval does not replace financial/security review or a reconciled parallel trial.

Legacy invoice-item import is disabled; approved total openings retain unknown age. Allocation ageing is today-only; historical statements remain supported. Zero-value financial postings are blocked (see ASSUMPTIONS.md). The UI offers trade/money opening import; other supported opening classifications are documented in the shared API contracts. This is an operational ledger, without configured statutory tax invoicing, stock management, automatic interest or bank verification.

No actual printer, public domain/TLS deployment, paid service, real bank integration, MFA deployment, malware scanner, encrypted off-server destination or monitoring connection has been configured. There is no offline financial posting or native APK. Long registers/reports are paginated; report CSV exports the displayed page. Full owner portability export is a separate bulk operation.

The local demo and isolated retained test/restore databases contain fictional test additions. No production deployment, destructive migration/reset or real-data import was performed. Exact check results and limits are in TEST_RESULTS.md; local/deployment/recovery instructions are linked from README.md.
