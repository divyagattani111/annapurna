# Implementation plan
Source of truth: CODEX_APP_CONTEXT.md (read in full, 6 November 2026).

1. Workspace, PostgreSQL 18 migrations, authentication and scoped masters.
2. Exact decimal engine, immutable journal, allocations, date locking, idempotency.
3. Bills and child receipts, verification, returns/refunds and statements.
4. Other money, loans/staff, deposits, reconciliation and close/reopen.
5. Responsive manager/owner UI, numeric reports then charts, print/export, evidence/audit.
6. Financial/concurrency/browser acceptance tests, isolated restore and runbooks.

Record actual progress and limitations in docs/STATUS.md and docs/TEST_RESULTS.md.
No production services or real data are authorized.

All six stages implemented and locally verified, 6 November 2026. Native and Linux PostgreSQL suites: 70 tests each; Chromium: 11 journeys. Backup/restore, restricted-role posting, build/typecheck/lint and dependency audit passed. Live review/setup and operational commissioning remain explicit in docs/STATUS.md.
