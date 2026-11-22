# Decisions and unresolved setup
- 7 November 2026: New Bill uses Salesman and Date together (today by default), then Product, Quantity, Selling Unit, Rate / Basis, Discount and Amount. Introductory notice and numbered entry headings were removed; note/paper reference is collapsed. Rate and numeric price basis edits affect only this bill. Selling units/conversions remain confirmed configuration.
- Discount explicitly selects a fixed INR total for the line or a percentage of its rounded gross. Blank means none; the default selector is ₹. Percentage discount rounds half-up to paise; net equals rounded gross minus discount. Discount cannot exceed gross, percentage cannot exceed 100, and quantity/conversion/basis must be positive. Zero-total bills remain blocked.
- Entry Amounts are non-posting server quotes; posting uses a fresh review. Drafts preserve price/basis/discount edits. Owner may edit; managers require frozen owner approval unless the owner grants independent `editBillPrices` / `applyBillDiscounts` capabilities. This change grants neither automatically. Effective price, basis, gross and discount are immutable snapshots used for printing and net-value returns.
- Demo only until all live setup gates are confirmed. All seeded people/products/accounts are fictional.
- INR, Asia/Kolkata; paise; line half-up rounding. No tax configuration, interest or profit calculation.
- One organization per session, owner and manager only; no salesman login in v1.
- Serialize financial writes per organization using a PostgreSQL transaction advisory lock. Suitable for this small business; favors correctness over write throughput.
- Posting balances come from immutable debit/credit journal lines. Allocation generations are retained; current applications are derived from effective sources, oldest first with returns prioritized to original bill.
- Bank identity is required for confirmation. Evidence is manually checked; no bank integration.
- Stitch export is now available in stitch_sales_money_book_pwa. Reviewed five screen PNGs, HTML and DESIGN.md. Use its palette/layout; specification overrides sample shop receivables, inventory claims, unverified saved badges, and sample real-looking data.
- Explicit units/configuration versions; no inferred M, live units/rates, balances, bank or tax data.
- Local native PostgreSQL 18 may be used for verification if Docker is unavailable. Production remains Compose/Caddy.
- Opening import supports approved total balances only, with unknown legacy age. Current allocation ageing is today-only; historical journal statements support selected dates.
- Zero-value opening postings, zero-total bills and zero-value returns are blocked. Record any required zero-value commercial documents only after their workflow is explicitly agreed; do not invent a financial movement to bypass validation.
- Public HTTPS, real printers, MFA, evidence malware scanning and off-server backup monitoring have not been commissioned. The app labels backup monitoring as not connected.
- 7 November 2026: owner requested the attached orange/amber dashboard look. This replaces the blue navigation palette, using white/stone cards and green/blue/rose daily totals. Manager home prioritizes action cards, daily activity, physical cash by custody and the verification queue. Existing account summaries and owner details remain available below; screenshot sample names and balances are not configuration data. The queue shows the server-returned claim count (100+ when capped), not a client-calculated money total.
- 7 November 2026: owner requested consistent dashboard/sidebar destinations and full-page workflows. Receive Money opens its section; Expense opens Other Money; Deposit/Transfer opens Cash & Bank. New bill and Daily Close open identical full-page entry views from either location. All former modal workflows (including statements, verification and drafts) render inside the main workspace with Back navigation; posting disables navigation until the server responds. Review, idempotency, permissions and server drafts retain their existing financial behavior.
- 18 November 2026: Overall bill flat discount is supported. Users can enter an optional flat rupee discount on the entire bill. Net billed amount equals sum of line items minus the bill discount. The discount cannot be negative and cannot exceed the total bill amount. Salesman khata is debited for the net amount. Product returns remain credited at regular line item price. Both owner and manager can apply overall flat bill discounts. Discount details are snapshotted in document data for clear display and physical printing.

- 19 November 2026: Master data architecture refactor. Replaced browser localStorage storage with persistent PostgreSQL tables (`employees`, `foods_salesmen`, `product_pack_pcs`) backed by REST API endpoints (`/api/v1/employees`, `/api/v1/foods-salesmen`, `/api/v1/product-pack-pcs`). Promoted salesmen `details` JSONB fields (`itc_id`, `beat_code`, `beat_name`, `route`) to indexed typed columns. Added relational foreign key columns on `documents` table (`customer_id` referencing `itc_customers.id`, `return_line_id` referencing `bill_lines.id`). Updated salesman update endpoint (`PATCH /api/v1/salesmen/:id`) to atomically cascade salesman name, ITC ID, and beat changes to both the typed columns on `salesmen` and all associated `itc_customers` records. ITC Excel export and direct cigarette sales summary endpoints now query live salesman data via SQL `LEFT JOIN` on `salesmen` rather than relying on duplicated or stale text columns.

- 19 November 2026: Second-pass architectural hardening completed.
  1. Automated FK Population: `post()` in `engine.ts` now automatically populates `customer_id`, `return_line_id`, `employee_id`, and `foods_salesman_id` foreign key columns on all new documents.
  2. Performance Indexes (Migration 0016): Added B-Tree composite indexes for all high-frequency query paths: `documents(org, customer_id)`, `documents(org, return_line_id)`, `documents(org, kind, business_date)`, `itc_customers(org, salesman_id)`, `product_configurations(org, product_id, effective_date DESC)`, and allocations/receipt_claims/cash_handovers FK indexes.
  3. Relational Staff & Foods Links (Migration 0017): Added `employee_id` and `foods_salesman_id` foreign key columns to `documents`, with validation in `packages/contracts` and UI state mapping in `apps/web`.
  4. Robust Cash Handover Querying: Replaced fragile magic string checks (`LIKE 'Cash handover confirmed%'`) with structural checks on `handoverId` and `isHandoverConfirmation`.

- 19 November 2026: Pure relational architecture transition finalized.
  1. Truncated legacy test transaction tables (`journal`, `bill_lines`, `allocations`, `documents`, etc.) with sequence reset.
  2. Master records (`salesmen`, `itc_customers`, `products`, `product_configurations`, `money_accounts`, `employees`, `foods_salesmen`, `organizations`, `user`, `members`) remained 100% protected and untouched.
  3. Removed all temporary `COALESCE(d.customer_id, d.data->>'customerId')` fallbacks across `apps/api/src/app.ts`. All bill, return, customer, and product queries now directly utilize typed indexed columns (`d.customer_id`, `d.return_line_id`, `s.itc_id`, `s.beat_code`, `s.beat_name`).

- 19 November 2026: Duplicate product entry prevention in New Bill.
  1. `ProductIdSearchableSelect`, `ProductSearchableSelect`, and `ConfectionerySearchableSelect` now support `disabledIds`.
  2. When selecting items on any bill line (desktop or mobile, manager or salesman direct view), products already added in another row are visually disabled (grayed out with a clear "Already in bill" badge, `cursor: not-allowed`, and clicks ignored).
  3. The currently selected item on that specific row remains highlighted and active with its checkmark. Barcode scanning retains its existing behavior of auto-focusing the existing row's quantity input.

- 19 November 2026: Restored employees and foods salesmen master records.
  1. Seeded all 13 employees (Naresh, Laxmi, Sugna, Saidulu, Biksham, kaleem, Nagaraju, Mubashir, Srinu, Gopi, Imtiyaz, Hari, mudassir) with their respective roles and phone numbers into the PostgreSQL `employees` table under active organization `Annapurna sales Corporation`.
  2. Seeded all 8 foods salesmen (Shareef, Nagarjun, waheed, Shashidhar, Praveen, Ali, Mahesh, and inactive Mudassir) into the PostgreSQL `foods_salesmen` table.

- 19 November 2026: Return bill document details & returned line items visualization.
  1. Updated `/api/v1/documents/:id` to automatically enrich return documents with linked original bill information (`originalBillNumber`, `originalBillDate`, `salesmanName`, `customerName`) and populate the returned item into `lines` with its snapshot and returned quantity.
  2. Updated `apps/web/src/main.tsx` (`DocumentView`) to render a dedicated Return Record view displaying: Original Bill #, Original Bill Date, Reason for return, Salesman khata credit, and the full returned item table (Product name, Code, Returned Quantity, Rate, Basis, and Refund Total).

- 21 November 2026: Stock Verification / Loading Sheet added to Financial & Operational Reports.
  1. Added dedicated `Stock Verification (Loading Sheet)` sub-tab to `ReportExplorer` in `apps/web/src/main.tsx`.
  2. Supports full warehouse/godown dispatch tallying across "All Routes / Salesmen" or filtered by specific individual salesmen.
  3. Includes date range picker (From/To) with presets (Today, Yesterday, Last 7 Days, All Dates), bill search, reversed bill toggle, and multi-bill selection.
  4. Aggregates all itemized products across selected bills using decimal-safe arithmetic (`Decimal.js`), displaying total billed dispatch quantity, MRP/rate, total value, and bill traceability.
  5. Tailored for warehouse physical stock audits: includes an interactive on-screen verification checklist, clean A4 printable loading sheet with blank physical count boxes for paper clipboard audits, signature lines for Godown In-Charge and Driver, formatted clipboard copy, and CSV export.
  6. Added sidebar-style collapsible left-side bill selector to both the Reports Stock Verification page and Mudhashir's Direct Cigarette Sales Loading Sheet page (`loadingSheetBillsCollapsed` / `billsSelectorCollapsed`). When collapsed, rather than disappearing, the selector docks into a slim vertical sidebar rail (displaying an expand toggle, selected count badge, and vertical label) that keeps the bills accessible while expanding the products verification table. Users can click anywhere on the rail or the toggle button to expand it back to full width.

- 21 November 2026: Compact Notes & Remarks column in transaction tables.
  1. Added space-efficient icon-only "Note" column (~40-70px wide) across all transaction tables: Financial & Operational Reports (All Transactions register), Category Registers (Bill, Receipts, Expenses, Foods collections, Transfers, General), Customer Statements, and Salesman Running Ledger Statements.
  2. Rows with notes render a clean 📝 icon with hover tooltip displaying the full multiline note/remark/reference without taking vertical or horizontal table space. Rows without notes display a faint dash (`—`).
  3. Real-time column search is enabled directly in the column filter row (`Search note…`) in both the All Transactions Register and Category Registers, integrated seamlessly alongside existing column filters and the "Clear Column Filters" reset button. Full-text search on Statement pages also checks note contents.
  4. Updated backend `reports/transactions` query to coalesce `note`, `notes`, `remarks`, `reference`, and `reason` from document payload JSONB.

- 21 November 2026: Bill Review & Confirmation Screen (New Bill Form & Saved Drafts).
  1. Added interactive temporary review screen modal when posting new bills from the "New Bill" page as well as when inspecting saved drafts in both Retail Salesman Bills (`Retail` tab) and Direct Cigarette / Customer Bills (`Mudashir` tab).
  2. On the "New Bill" creation form, clicking the primary action button ("Review & Post Bill") validates inputs and opens the temporary review screen rather than posting directly to the ledger.
  3. Clicking on any saved draft card or clicking the "Review Bill" button also opens this dedicated temporary review screen.
  4. The review screen provides a full breakdown: party name (Salesman debtor or Customer & Route), bill date, paper reference, notes, and a structured itemized table of all products (cigarette and confectionery) with ledger rates, quantities, units, and line amounts.
  5. Server-verified ledger quote integration: automatically queries `preview/bill` to verify accurate rate snapshots, subtotal, discount, grand total, and expected quote hash directly against the backend calculation engine.
  6. Includes full payment details breakdown (cash and bank accounts, payment references) and calculated remaining balance owed to ledger.
  7. Clear actions:
     - "Back to Edit" / "Edit in Form": closes the review screen and preserves all entered form values so the user can make adjustments.
     - "Confirm & Post Bill": directly posts atomically to `commands/bill` with exact quote verification, resetting form state and notifying the user upon completion (no redundant browser popup alert).
     - "Delete Draft": available when reviewing a saved draft, with confirmation safety prompt.


- 21 November 2026: Removed "Current unsettled dues and age" sub-tab.
  1. Removed the "Current unsettled dues and age" (`ageing`) sub-tab from `ReportExplorer` in `apps/web/src/main.tsx` to streamline report navigation.
  2. Remaining sub-tabs under Financial & Operational Reports: `All transactions`, `Stock Verification (Loading Sheet)`, and `Daily closes and differences`.
  3. Real-time salesman khata dues, outstanding balances, and running ledger statements remain accessible from their respective salesman ledger and customer pages.

- 22 November 2026: ESLint cleanup across monorepo (`apps/api`, `apps/web`).
  1. Resolved all 46 ESLint errors (`prefer-const`, `@typescript-eslint/no-unused-vars`, `no-extra-boolean-cast`, and `prefer-rest-params`).
  2. Fixed `apps/api/src/app.ts` (`entries`, `allocations`, `attachments` const destructuring).
  3. Cleaned up `apps/api/src/seed.ts` (removed unused `command`, `_a`, and redundant `arguments` category assignment).
  4. Cleaned up `apps/web/src/main.tsx` (removed unused imports `Suspense`, `lazy`, `Landmark`, `ChevronRight`, `CirclePlus`, `ShieldCheck`, `MapPin`, `Chart`; pruned dead draft modals and state variables; fixed `From` date picker `onChange` handler).
  5. Verified: `bun run lint`, `turbo typecheck`, `turbo build`, and all 21 unit tests pass with zero errors.

- 22 November 2026: Database integration test suite execution and migration journal synchronization.
  1. Configured private `.env.test` pointing to PostgreSQL 18 `family_ledger_test` database in test mode (`APP_MODE=test`, isolated attachments directory).
  2. Synchronized `packages/db/migrations/meta/_journal.json` to register migrations 0011 through 0018 so `drizzle-orm` properly discovers and executes all additive migrations on fresh/test databases.
  3. Wrapped document backfills in migration `0015_great_architecture.sql` with `ALTER TABLE documents DISABLE/ENABLE TRIGGER documents_immutable` to allow relational FK backfills past the immutability trigger during migration.
  4. Ran full integration test suite (`tests/integration.test.ts`): all 66 test suites passed with 0 failures (covering 253 assertions across acceptance cases A01–A55, advisory concurrency locks, idempotency, refund credit conservation, and permissions).
