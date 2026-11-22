# Executed checks — 6 November 2026

## Editable New Bill grid — 7 November 2026

Final typecheck (4 tasks), lint and build (4 tasks) passed. Native Bun/PostgreSQL: **77 passed, 0 failed, 285 assertions, 5.94 s**. Linux Docker Bun/PostgreSQL: **77 passed, 0 failed, 285 assertions, 7.07 s**; updated API image built. Chromium: **13 passed, 14.6 s**. No migration was needed; no live data or deployment was touched.

New checks cover exact rate/basis/fixed/percentage calculations, excessive discounts, nonpositive pricing operands, net-value partial returns, immutable master/effective snapshots, manager approval and independent owner-managed capabilities, permission checks before cached retries, and quote binding despite equal totals. The browser checks today's default date, six-column layout, notice/number removal, live server amounts, edited-price draft recovery and owner-review routing. Earlier tests caught and corrected a zero-basis validation issue; the keyboard journey now follows the date control's native tab stops.

Logs: `.local/bill-grid-typecheck.log`, `.local/bill-grid-lint.log`, `.local/bill-grid-build.log`, `.local/bill-grid-postgres.log`, `.local/bill-grid-browser.log`, `.local/bill-grid-docker-build.log`, `.local/bill-grid-docker-tests.log`. Backup/restore, performance and audit results below retain their original dates; they were not repeated for this change.

The edited grid was visually inspected at 1440 px and checked at 360 px without page overflow. Screenshots: `.local/new-bill-editable-grid.png` and `.local/new-bill-editable-grid-phone.png`; log `.local/bill-grid-preview.log`. This preview used fictional values and made no financial posting.

## Full-page navigation — 7 November 2026

Dashboard shortcuts now share sidebar destinations; all former dialog workflows render as full-page regions within the main workspace. Final checks: **typecheck passed (4 tasks), lint passed, build passed (4 tasks)**. Native Bun/PostgreSQL suite: **70 passed, 0 failed, 242 assertions, 3.76 s**. Chromium: **12 passed, 10.4 s**, including a new comparison of all five dashboard shortcuts with their sidebar destinations, full-width form placement, active sidebar state, absence of modal dialogs and preservation of an in-progress bill when its active sidebar button is clicked again. Existing billing, keyboard, draft, verification, export, print and phone journeys remain passing.

Logs: `.local/fullpage-typecheck.log`, `.local/fullpage-lint.log`, `.local/fullpage-build.log`, `.local/fullpage-postgres.log`, `.local/fullpage-browser.log`. The draft journey's former Close-dialog locator was updated to the new Back button before the final run. No backend/schema/migration change was required; Linux images and restore drills were not repeated for this UI change.

Rendered bill and daily-close pages were visually inspected at 1366 px. Both also passed a 360 px page-overflow check. Screenshots: `.local/new-bill-fullpage.png`, `.local/new-bill-fullpage-phone.png`, `.local/daily-close-fullpage.png`; result log `.local/fullpage-preview.log`. This preview made no financial posting.

## Dashboard restyling — 7 November 2026

The owner-supplied orange dashboard reference was applied to the React dashboard and shared shell. Ledger/backend/migrations were unchanged. Typecheck (4 tasks), lint and production build (4 tasks) passed. Native Bun/PostgreSQL regression: **70 passed, 0 failed, 242 assertions, 5.48 s**. Final Chromium journeys: **11 passed, 10.1 s**, including the owner phone/large-text check, billing, drafts, verification, export and printing. Logs: `.local/dashboard-typecheck.log`, `.local/dashboard-lint.log`, `.local/dashboard-build.log`, `.local/dashboard-postgres-tests.log`, `.local/dashboard-browser.log`.

The rendered manager dashboard was also inspected at 2048 px and 1366 px; phone/desktop checks found no page overflow at 360 px and 1366 px. Preview files: `.local/dashboard-orange-desktop.png`, `.local/dashboard-orange-1366.png`, `.local/dashboard-orange-360.png`. This visual change did not repeat the Linux image, vulnerability audit or restore drill below; those results retain their original date. A transient unused-import lint error was corrected before the final passing check.

These results describe the final local implementation, not a production certification. Test data is fictional. PostgreSQL integration suites exercise the real database; no SQLite or browser-only ledger substitutes are used. See ACCEPTANCE.md for the 55-case evidence map and STATUS.md for limitations.

## Final automated results

| Check | Actual result |
|---|---|
| Workspace TypeScript | Passed: 4/4 Turbo tasks |
| ESLint | Passed, exit 0 |
| Production workspace build | Passed: 4/4 Turbo tasks |
| Native Bun 1.4.4 + PostgreSQL 18, unit and integration | **70 passed, 0 failed; 242 assertions; 6.90 s** |
| Linux Docker Bun 1.4.4 + PostgreSQL 18.6, same suite | **70 passed, 0 failed; 242 assertions; 5.27 s** |
| Playwright Chromium, demo API/Vite | **11 passed; 14.9 s** |
| Dependency audit, locked graph | No vulnerabilities found, 266 packages checked |
| API and Caddy images | Built successfully |
| Operations image | Built; Bun 1.4.4 and PostgreSQL client 18.6 smoke checks passed |
| Caddy configuration validation | Passed; no public TLS issuance/deployment attempted |
| Restricted runtime PostgreSQL role | Authenticated financial posting passed; financial-history UPDATE denied with privilege error |
| Drizzle schema generation | No schema changes after reviewed migrations 0000–0005 |

Commands are in README.md. On this machine, native suite logs are ignored private files `.local/final-tests.log`, `.local/final-browser.log`, `.local/typecheck.log`, `.local/lint.log`, `.local/build.log`, and `.local/audit-final.log`. Container results are `.local/docker-tests.log`, `.local/docker-build.log`, `.local/operations-build.log`, `.local/runtime-role-final.log` and `.local/caddy-validate.log`. Credentials are not part of this report.

The native suite command was:

```sh
.tools/bun/bin/bun --no-env-file --env-file=.local/test.env test tests/unit.test.ts tests/integration.test.ts
```

The Linux suite used the isolated internal-network PostgreSQL service:

```sh
docker compose --env-file .local/test-compose.env -p family-ledger-acceptance -f infra/compose.test.yaml run --rm test bun --no-env-file test tests/unit.test.ts tests/integration.test.ts
```

## Browser journeys

1. Login persistence, reload and logout revocation.
2. Bill validation, review and one committed bill.
3. Offline review preserves entries and never displays false saved state.
4. Owner dashboard at 360 px and enlarged text without page overflow.
5. Verification queue, cashbook and committed-document printing.
6. Keyboard-only F2, tab/select, review and posting.
7. Server draft recovery and atomic consumption.
8. A 100-line bill produces a multipage PDF with its table and totals.
9. Rejected evidence upload preserves the committed financial record and shows the secondary failure.
10. Online confirmation through the UI posts one bank receipt; retry remains safe.
11. CSV equals the displayed report snapshot even when another receipt posts before download.

Phone and print artifacts are `.local/owner-phone.png`, `.local/bill-print.png` and `.local/multipage-bill.pdf`. An actual physical printer, cross-browser/device matrix and public HTTPS session have not been tested.

## Backup and authorization evidence

A fictional PNG was uploaded privately, downloaded while authenticated, then denied after logout. Native backup/isolated restore checks compare exact journal account balances, document/member/audit/evidence counts, permission contents, audit-content SHA-256 and evidence hashes. The restored database and attachments remain private for inspection; there is no destructive cleanup or replacement of an existing database.

The final completed drill snapshot is `.local/backups/2026-11-06T10-48-40.197Z`; restored database `family_ledger_drill_0b283076c0bd4b2eb1992f4d044c5856_restore`, with evidence under `.local/restore-attachments/` for that database. Results are in `.local/handover-backup.log` and `.local/handover-restore.log`. This proves the tested fictional snapshot, not live credentials, an off-server destination, monitoring or recovery-time targets. See BACKUP_RESTORE.md for the reproducible procedure.

Generated local demo passwords were refreshed privately after browser testing, both new sign-ins were checked, and existing demo sessions were revoked. Current passwords are in the ignored mode-0600 `.env`; none are printed here.

## Performance sample

Final native warm-database single-run timings on the retained fictional fixture of **10,000 bills / 100,000 lines**, measured at 10:46 UTC:

| Request | Elapsed |
|---|---:|
| Dashboard | 299.38 ms |
| Document register page | 9.96 ms |
| Product report | 496.96 ms |
| Outstanding report | 50.62 ms |
| Receipt posting with allocation | 65.77 ms |

The fixture was bulk-created in 4,726 ms; that is not command-posting throughput. Measurements include authenticated in-process API handling and PostgreSQL, not public network/TLS/browser latency. They are not percentiles, concurrent-user load tests or a VPS capacity guarantee. Details are retained in `.local/performance-final.json`; `scripts/measure-existing.ts` repeats measurement without creating another large fixture.

## Failures found and corrected

During development, checks exposed a deferred trigger record-field error, slow dashboard join plans, reversal report double counting, native controlled-select keyboard behavior, stale review risk and export drift. Each was corrected and the relevant final suites above passed. Development failures are not represented as passing results. No final automated check listed above remains failing; independent financial/security review, actual printer checks, real setup and a reconciled parallel trial remain required before live use. Hosted CI has been supplied but has not been run remotely.
