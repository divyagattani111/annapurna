# Memory Bank: Family Sales Ledger

A comprehensive technical, functional, and operational reference for the **Family Sales Ledger** system.

---

## 1. Executive Summary & Core Philosophy

**Family Sales Ledger** is an operational sales, debtor management, and money movement diary engineered for distribution businesses and family-run trading operations. 

### Core Business Model
* **The Salesman is the Debtor**: When goods are billed to a salesman, he personally owes the business for those products. He is an authorized trading counterparty/debtor, not merely a courier or collection conduit.
* **Recording Money, Not Sending Money**: The system records real-world operational events (cash received, bank deposits, expenses, returns, salary setoffs). It **never** initiates electronic fund transfers or live banking payouts.
* **Strict Double-Entry Balanced Journal**: Every financial transaction creates balanced, atomic debit and credit entries in an append-only journal (`journal` table).
* **Zero Floating-Point Drift**: All posted monetary values are stored in PostgreSQL as `NUMERIC(18, 2)` (or `NUMERIC(24, 8)` for quantities and rates). In TypeScript and JSON, money is represented strictly as decimal strings and processed with **Decimal.js** (60-digit precision, half-up rounding to paise). Standard JavaScript floating-point numbers (`number`) are forbidden for financial amounts.
* **Immutable History & Linked Reversals**: Posted documents, lines, allocations, and journal lines cannot be updated or deleted (`UPDATE` and `DELETE` are blocked by database triggers). Adjustments and corrections require linked reversal entries.

---

## 2. Technology Stack & Workspace Architecture

The system is configured as a high-performance TypeScript monorepo orchestrated with **Turborepo** and **Bun**.

| Layer | Technology | Key Details |
|---|---|---|
| **Runtime & Package Manager** | Bun 1.4.4+ | Fast native JavaScript/TypeScript runtime and package manager |
| **Monorepo Tooling** | Turborepo 2.11+ | Task orchestration, caching, pipeline builds (`turbo.json`) |
| **Frontend (`apps/web`)** | React 19, Vite, TypeScript | SPA, Tailwind CSS, Lucide icons, accessible shadcn/ui controls, TanStack Query, lazy ECharts, browser printing |
| **Backend API (`apps/api`)** | Bun + Hono v4 | Versioned REST API (`/api/v1`), Better Auth session auth, transactional financial command engine |
| **Shared Contracts (`packages/contracts`)** | Zod 3.x | Zero-dependency browser-safe validation schemas, strict command payloads, decimal string contracts |
| **Persistence (`packages/db`)** | PostgreSQL 18, Drizzle ORM | Server-only Drizzle ORM, custom SQL migration scripts, advisory locks, PostgreSQL triggers |
| **Infrastructure & Deploy** | Docker Compose, Caddy | Caddy reverse proxy (auto-HTTPS), non-root Docker containers, Ubuntu VPS deployment |
| **Testing** | Bun Test, Playwright | Unit tests, PostgreSQL integration tests, Playwright browser E2E tests, bulk performance benchmarks |

---

## 3. Repository & Workspace Layout

```
codex/
├── apps/
│   ├── api/                     # Bun + Hono REST API server (/api/v1)
│   │   └── src/
│   │       ├── app.ts           # Hono routing, middleware, route handlers, error handling
│   │       ├── auth.ts          # Better Auth configuration, session validation, password hashing
│   │       ├── engine.ts        # Financial posting engine, transaction management, advisory locks
│   │       ├── money.ts         # Decimal arithmetic, rate calculation, discount computation
│   │       ├── seed.ts          # Idempotent demo database seeder
│   │       └── index.ts         # Server entry point (binds loopback 127.0.0.1 by default)
│   └── web/                     # React + Vite frontend application
│       └── src/
│           ├── main.tsx         # Main UI shell, workflows, registers, khata views, modals
│           ├── chart.tsx        # ECharts lazy wrapper for performance-friendly rendering
│           ├── style.css        # Tailwind & custom CSS variables, responsive design
│           └── vite-env.d.ts    # Vite TypeScript environment declarations
├── packages/
│   ├── contracts/               # Shared Zod schemas & types
│   │   └── src/
│   │       ├── index.ts         # API schemas, command payload contracts, domain models
│   │       └── csv.ts           # CSV export sanitization & formula injection defense
│   └── db/                      # Database package (server-only)
│       ├── migrations/          # Reviewed additive SQL migrations (0000 - 0005)
│       └── src/
│           ├── index.ts         # Drizzle client, pool configuration
│           ├── migrate.ts       # Migration execution script
│           └── schema.ts        # Drizzle schema definitions (tables, relations, types)
├── docs/                        # Architectural specifications and guides
│   ├── ACCEPTANCE.md            # 55-case acceptance test criteria and evidence checklist
│   ├── API.md                   # Complete API endpoint and command catalog
│   ├── BACKUP_RESTORE.md        # Backup scripts, disaster recovery drills, retention
│   ├── DATA_MODEL.md            # Table relationships, posting maps, journal triggers
│   ├── DEPLOYMENT.md            # VPS deployment guide, Caddy setup, systemd services
│   ├── MANAGER_GUIDE.md         # Operational handbook for managers & cashiers
│   ├── PERMISSIONS.md           # Role-based access control (RBAC) & capability matrix
│   ├── STATUS.md                # Implementation milestones and release notes
│   └── TEST_RESULTS.md          # Test suite outputs and benchmark validations
├── infra/                       # Infrastructure configuration
│   ├── caddy/                   # Caddyfile configuration with security headers
│   ├── compose.dev.yaml         # Local PostgreSQL 18 development container
│   └── compose.yaml             # Production Docker Compose orchestration
├── scripts/                     # Operational and maintenance scripts
│   ├── backup.ts                # PostgreSQL native pg_dump backup script with SHA-256
│   ├── restore-drill.ts         # Automated non-destructive restore drill into test DB
│   ├── performance.ts           # 10,000-bill and 100,000-line load test suite
│   ├── provision-owner.ts       # CLI tool to provision initial owner account
│   └── runtime-permissions.ts   # Database privilege hardening script
├── tests/                       # Automated test suites
│   ├── unit.test.ts             # Pure business logic and decimal calculation tests
│   ├── integration.test.ts      # Multi-step transactional PostgreSQL API tests
│   └── e2e/                     # Playwright end-to-end browser user journeys
├── AGENTS.md                    # Coding agent constraints and required conventions
├── ASSUMPTIONS.md               # Explicit assumptions, policy boundaries, and decisions
├── CODEX_APP_CONTEXT.md         # Full formal business and technical system specification
├── PLAN.md                      # Development milestones and execution roadmap
└── README.md                    # Quickstart guide and local run instructions
```

---

## 4. Non-Negotiable Business Rules & Architectural Tenets

1. **No JavaScript Floating-Point Arithmetic for Money**:
   - Every price, total, discount, payment, balance, and allocation uses `Decimal.js` with exact 2-decimal rounding (`ROUND_HALF_UP`) for money, and up to 8 decimal places for quantities and unit conversions.
   - Client applications never calculate financial totals; all totals are computed and verified authoritatively by `apps/api/src/money.ts`.
2. **Atomic Organization-Level Advisory Lock**:
   - Financial writes serialize per organization using PostgreSQL transaction-level advisory locks (`pg_advisory_xact_lock(hashtext('org:' || org_id))`).
   - Prevents race conditions, concurrency anomalies, credit-limit bypassing, and double-spend errors during simultaneous billing or settlement.
3. **Strict Idempotency**:
   - All financial mutations (`POST /api/v1/commands/:name`) require an `Idempotency-Key` HTTP header (16–200 characters).
   - The engine stores a SHA-256 hash of the canonical request payload. Retrying with identical keys and payloads returns the committed response without re-executing. Retrying with different payloads returns `IDEMPOTENCY_CONFLICT` (409).
4. **Balanced Journal Trigger Guard**:
   - A deferred database constraint trigger verifies that `SUM(debit) == SUM(credit)` for every document sequence in the transaction before committing. Any imbalance aborts the entire transaction.
5. **No Double-Counting Bank Deposits as Collections**:
   - Depositing physical cash into a bank account credits cash and debits an intermediary transit account (`transit:<deposit_id>`). When the bank credits the funds, transit is credited and the bank account is debited. This never touches salesman dues or revenue accounts.
6. **Immutable Historical Records**:
   - Database triggers disallow `UPDATE` or `DELETE` on `documents`, `bill_lines`, `journal`, `allocations`, and `bank_identities`. Errors are corrected via explicit, authenticated reversing documents.
7. **Day Closing Routine**:
   - Posting is only allowed for the open date. When the day is closed, physical cash is counted and compared to book cash. Any variance is recorded explicitly as an unresolved difference (never swept into an expense account). Reopening a day requires owner privilege and marks subsequent reconciliations stale.

---

## 5. Detailed Feature & Functional Guide

### 5.1 Dashboard (Home)
- **Status Banners**: Real-time business date, timezone (`Asia/Kolkata`), operational state (`DAY OPEN` vs `DAY CLOSED`), and operational mode (`DEMO` vs `LIVE`).
- **Financial Cards**:
  * **Today's Net Sales**: Total billed merchandise minus linked line returns for the current date.
  * **Cash Collected**: Total cash physically taken into custody today.
  * **Digital / Bank Collections**: Verified online receipts credited today.
  * **Total Salesmen Outstanding**: Total aggregate debit balance across all salesmen khatas.
- **Cash Custody Overview**: Live balances of physical cash drawers and owner-held cash pockets.
- **Pending Online Queue**: Quick-action banner indicating pending online payment claims awaiting statement verification.

### 5.2 Retail / Billing & Salesman Khata
- **New Bill Entry**:
  * Salesman selector with real-time outstanding balance and credit limit alerts.
  * Multi-item line entry: Product, Quantity, Selling Unit (pieces, boxes, kg, cartons), Conversion Factor to Base Unit, Base Unit Rate, Line Rate/Basis Overrides.
  * **Line Discounts**: Whole-line fixed amount (₹) or percentage discount (up to 8 decimal places, capped at 100%).
  * **Quote Review Hash (`expectedQuoteHash`)**: The client requests a non-posting preview (`POST /api/v1/preview/bill`), which returns computed net amounts and a cryptographic hash. The actual posting requires this hash; if underlying prices or configurations changed, the transaction aborts with `STALE_REVIEW`.
  * **Server Drafts**: Supports saving in-progress bills to the database (`POST /api/v1/drafts`), version-controlled to avoid overwrite conflicts across tabs.
  * **Accompanying Payments**: Option to record an initial cash receipt or declare an online receipt claim directly alongside the bill in an atomic transaction.
- **Salesman Khata Book**:
  * Full chronological running ledger for each salesman.
  * Brought-forward (`B/F`) balance calculation for any chosen date range.
  * Expandable document rows displaying exact line items, unit rates, payment legs, and references.
  * Thermal and A4 printable statements with formal header, brought-forward summary, and closing balance.
- **Linked Goods Returns**:
  * Returns reference original bill lines, snapping to historical prices and units.
  * Built-in validations prevent returning more than the original quantity minus prior returns.
  * Returns credit the salesman's trade account and reduce outstanding dues; they do not disburse cash.
- **Cash & Bank Refunds**:
  * Cash/bank refunds can only be paid out against verified unallocated credit balances.

### 5.3 Receive Money & Online Claims
- **Direct Receipt Entry**:
  * Instant collection recording from any salesman without creating a new bill.
  * Supports physical cash or digital methods (UPI, NEFT, RTGS, IMPS, Cheque).
  * **Split Payments**: Collect a single payment across multiple legs (e.g., partial cash + partial online transfer) in a single atomic transaction.
  * **Oldest-First (FIFO) Allocation**: Payments automatically settle outstanding bills in order of age. Any excess payment remains an advance on the salesman's khata.
- **Online Verification Lifecycle**:
  1. *Pending Claim*: Payment claimed by salesman or cashier enters the verification queue with reference ID, claimed bank, and screenshot attachment.
  2. *Verification*: Manager/Owner compares claim against actual bank statements, enters the bank transaction reference, and confirms.
  3. *Financial Posting*: Once confirmed, the document is officially posted as a verified receipt, credits the salesman khata, and settles dues. If fraudulent or uncredited, the claim is rejected with a documented reason.

### 5.4 Cash & Bank Operations
- **Account Custody**: Separates physical cash drawers (custody of cashier) from owner-held cash and bank accounts.
- **Internal Transfers**: Transferring funds between cash drawers or between bank accounts without revenue/expense distortion.
- **Cash Deposits in Transit**:
  * Step 1: Handing cash to a runner/bank agent moves money from Cash to `transit:<deposit_id>`.
  * Step 2 (`resolveDeposit`): When the bank credits the deposit, the transit account is cleared and the bank account is debited. If part of the cash is returned physically, it is returned to drawer cash.
- **Unidentified Bank Credits**:
  * Unknown credits appearing on bank statements are posted to a `holding` account.
  * Subsequently identified via `POST /api/v1/commands/identify` and assigned to one or more salesmen's khata accounts.

### 5.5 Other Money (Non-Trading Transactions)
- **Categorized Business Expenses**: Multi-leg expense payments (e.g., freight, tea/snacks, electricity, rent) with split payment accounts.
- **Staff Advances & Salaries**:
  * Disbursing salary advances tracked in dedicated receivable accounts (`staff:<advance_id>`).
  * Monthly salary posting with automatic advance setoff: Gross Salary is debited to Expense, Advance is credited to clear the receivable, and only the Net Amount is paid in cash/bank.
- **Loans Given & Borrowings**:
  * Business loans extended to third parties or borrowed from outside entities.
  * Distinct principal tracking and repayments (preventing loan recovery from being counted as trading revenue).
- **Owner Equity & Capital**:
  * Owner capital injections credited to owner equity/payable accounts.
  * Owner drawings recorded as equity withdrawals (differentiated from business expenses).

### 5.6 Daily Closing, Differences & Audit
- **Daily Close Workflow**:
  * End-of-day reconciliation modal/screen.
  * Physical cash count entered per cash account.
  * Book cash automatically computed from opening balance + debit/credits.
  * Discrepancies recorded as `difference` with mandatory explanation.
  * Day date marked closed; subsequent postings on that date are blocked.
- **Reopening a Closed Day**:
  * Allowed only for Owners with a documented operational reason.
  * Marks subsequent daily closes and bank reconciliations as `stale`.
- **Sanitized CSV & Formatted Exports**:
  * Direct browser export of displayed table data.
  * Formula injection defense: automatically neutralizes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` to prevent CSV injection in spreadsheet software.
- **Document Attachments**:
  * Multipart upload of receipts, bank slips, and vouchers (up to 10 MB).
  * Enforces MIME type checks (`image/jpeg`, `image/png`, `application/pdf`) and verifies file magic numbers.

---

## 6. Posting Map & Financial Accounting Engine

The ledger maintains internal stable dimensions for all financial transactions:

```
journal.account = 
  ├── trade:<salesman_uuid>        # Salesman debtor khata
  ├── money:<account_uuid>         # Cash drawers, owner cash, bank accounts
  ├── loan:<loan_uuid>             # Loans given (receivable)
  ├── borrowed:<loan_uuid>         # Loans taken (payable)
  ├── staff:<advance_uuid>         # Staff salary advances
  ├── transit:<deposit_uuid>       # Cash deposited but not yet cleared
  └── holding:<credit_uuid>        # Unidentified bank credits
```

### Complete Transaction Matrix

| Transaction Type | Debit (DR) | Credit (CR) | Notes |
|---|---|---|---|
| **Sales Bill** | `trade:<salesman>` | `control:sales` | Salesman owes the business for the merchandise |
| **Cash / Bank Receipt** | `money:<account>` | `trade:<salesman>` | Reduces salesman outstanding balance |
| **Sales Return** | `control:returns` | `trade:<salesman>` | Linked to original bill line |
| **Cash Refund** | `trade:<salesman>` | `money:<account>` | Disburses cash for excess return credit |
| **Expense Payment** | `expense:<category>` | `money:<account>` | Supports multi-leg payment splits |
| **Internal Transfer** | `money:<dest_account>` | `money:<source_account>` | Cash drawer to cash drawer or bank to bank |
| **Deposit Handed Over**| `transit:<deposit>` | `money:<cash_account>` | Cash is out of drawer but not yet in bank |
| **Deposit Credited** | `money:<bank_account>` | `transit:<deposit>` | Clears transit; no impact on sales or dues |
| **Loan Given** | `loan:<loan_id>` | `money:<account>` | Separate receivable dimension |
| **Loan Repaid (Inward)**| `money:<account>` | `loan:<loan_id>` | Principal repayment; not trading revenue |
| **Borrowing Received** | `money:<account>` | `borrowed:<loan_id>` | Liability created |
| **Borrowing Repaid** | `borrowed:<loan_id>` | `money:<account>` | Liability cleared |
| **Salary with Setoff** | `expense:salary` (Gross)| `staff:<advance>` (Advance) + `money:<account>` (Net)| Clears advance and disburses net cash |
| **Owner Capital In** | `money:<account>` | `owner:capital` | Equity injection |
| **Owner Withdrawal** | `owner:capital` | `money:<account>` | Personal drawing |
| **Unidentified Bank In**| `money:<bank_account>` | `holding:<credit_id>` | Bank increased; liability in holding |
| **Identify Bank Credit**| `holding:<credit_id>` | `trade:<salesman>` | Clears holding; credits salesman khata |
| **Reversal Document** | *Exact original Credits*| *Exact original Debits* | Atomic 1:1 reversal of incorrect document |

---

## 7. Role-Based Access Control (RBAC) & Governance

The platform defines three roles: **Owner**, **Manager**, and **Salesman**.

| Operation / Feature | Owner | Manager | Salesman |
|---|---|---|---|
| View Dashboard & Operational Reads | Yes | Yes | Limited to self |
| View Own Khata Statement | Yes | Yes | Yes (self-only) |
| Post Standard Bills, Cash Receipts, Expenses | Yes | Yes (Open Date only) | No |
| Edit Bill Rates / Price Basis | Yes | Capability: `editBillPrices` | No |
| Apply Custom Bill Line Discounts | Yes | Capability: `applyBillDiscounts` | No |
| Verify / Reject Online Payment Claims | Yes | Yes (unless revoked) | No |
| Disburse Loans, Staff Advances, Refunds | Post | Frozen Request only | No |
| Daily Day Close | Yes | Yes | No |
| Reopen Closed Day | Yes | No | No |
| Master Data Edits (Products, Rates, Accounts)| Yes | No | No |
| User & Permission Management | Yes | No | No |
| Portability Export & Audit Logs | Yes | No | No |

### Frozen Approval Request Flow
When a Manager attempts a high-risk operation without explicit permission (e.g., disbursing a loan, giving a cash refund, or submitting a bill exceeding a salesman's credit limit):
1. The payload is validated and stored in `requests` table in a frozen state.
2. The Manager is informed that the action has been submitted for Owner review.
3. The Owner navigates to Requests, reviews the exact payload and calculated effects, and approves or rejects it.
4. Approval posts the financial command atomically within the Owner's transaction.

---

## 8. How to Run: Local Setup & Development Guide

### 8.1 System Prerequisites
* **Bun**: `1.4.4` or higher installed (`bun --version`).
* **PostgreSQL**: Version 18 (installed locally or running via Docker).
* **Docker & Docker Compose**: For local isolated database testing.
* **Playwright Chromium**: For browser end-to-end tests (`bunx playwright install chromium`).

### 8.2 Environment Configuration
Create the local environment files from templates:

```bash
# 1. Monorepo environment
cp .env.example .env
chmod 600 .env

# 2. Docker Compose environment (for Postgres container)
cat <<EOF > .env.compose
POSTGRES_PASSWORD=local_dev_password_only
POSTGRES_PORT=5433
EOF
chmod 600 .env.compose
```

Edit `.env` and configure:
```ini
DATABASE_URL=postgresql://ledger:local_dev_password_only@127.0.0.1:5433/family_ledger_demo
BETTER_AUTH_SECRET=random_at_least_32_characters_long_secret_key_here
BETTER_AUTH_URL=http://127.0.0.1:5186
APP_ORIGIN=http://127.0.0.1:5186
PORT=3000
APP_MODE=demo
DEMO_OWNER_PASSWORD=OwnerSecurePassword123!
DEMO_MANAGER_PASSWORD=ManagerSecurePassword123!
ATTACHMENTS_DIR=./private-files/attachments
```

> **Note**: Always use `http://127.0.0.1:5186` (or `http://localhost:5186`) consistently to ensure cookies and CORS origins match between frontend and backend.

### 8.3 Starting Development Services

```bash
# Step 1: Install workspace dependencies with frozen lockfile
bun install --frozen-lockfile

# Step 2: Start PostgreSQL 18 in Docker
docker compose --env-file .env.compose -f infra/compose.dev.yaml up -d

# Step 3: Run database migrations
bun --no-env-file --env-file=.env run db:migrate

# Step 4: Seed demo data (idempotent, safe for demo databases)
bun --no-env-file --env-file=.env run db:seed:demo

# Step 5: Start both API and Web servers via Turborepo
bun --no-env-file --env-file=.env run dev
```

### 8.4 Accessing the Application
- Open your browser at: `http://127.0.0.1:5186`
- **Owner Account**:
  * Email: `owner@demo.invalid`
  * Password: The password specified in `DEMO_OWNER_PASSWORD`
- **Manager Account**:
  * Email: `manager@demo.invalid`
  * Password: The password specified in `DEMO_MANAGER_PASSWORD`

---

## 9. Verification, Testing & Quality Assurance

The codebase enforces strict quality checks across type safety, code formatting, unit calculations, database integration, and UI workflows.

### 9.1 Static Checks & Linters
```bash
# TypeScript compiler type check across all workspaces
bun --no-env-file run typecheck

# ESLint check
bun --no-env-file run lint

# Production build check (Vite + Hono packaging)
bun --no-env-file run build
```

### 9.2 Running Unit Tests
Executes arithmetic, Decimal.js rounding, discount rules, CSV formula neutralization, and contract validation tests:
```bash
bun --no-env-file test tests/unit.test.ts
```

### 9.3 Running PostgreSQL Integration Tests
Requires a dedicated, isolated test database (`family_ledger_test`).
```bash
# 1. Setup .env.test with a distinct test database
cp .env .env.test
# (Ensure DATABASE_URL points to family_ledger_test and APP_MODE=test)

# 2. Run migrations on test database
bun --no-env-file --env-file=.env.test run db:migrate

# 3. Execute integration test suite
bun --no-env-file --env-file=.env.test run test:integration
```
*Coverage*: Exercises full multi-step financial flows, balanced journal triggers, FIFO allocations, idempotency cache handling, split payments, online claims, and day close locks.

### 9.4 Running End-to-End Browser Tests
Executes Playwright browser journeys against the running dev servers:
```bash
bun --no-env-file --env-file=.env run test:e2e
```

### 9.5 Performance & Load Benchmark
Injects 10,000 historical bills and 100,000 line items into the test database and validates query performance under 100ms for registers, reports, and khata balance calculations:
```bash
bun --no-env-file --env-file=.env.test run test:performance
```

---

## 10. Operations, Backups & Disaster Recovery

### 10.1 Database Backup Script
The repository provides a standalone PostgreSQL backup script (`scripts/backup.ts`) leveraging native `pg_dump`:
```bash
bun --no-env-file --env-file=.env run backup
```
- Outputs custom-format dumps to `./private-files/backups/`.
- Computes and records SHA-256 integrity checksums.
- Verifies database connectivity and writes execution logs.

### 10.2 Automated Non-Destructive Restore Drill
To ensure backup files are valid and recoverable without touching active demo or production databases:
```bash
bun --no-env-file --env-file=.env.test run restore:drill
```
- Creates an isolated scratch database (`restore_drill_<timestamp>`).
- Restores the latest dump using `pg_restore`.
- Executes data validation queries (verifying document counts and journal balances).
- Cleans up and drops the scratch database upon verification.

### 10.3 Database Schema Migrations
Database migrations are strictly reviewed and additive:
```bash
# Generate new migration from Drizzle schema modifications
bun --no-env-file run db:generate

# Apply pending migrations to the configured database
bun --no-env-file --env-file=.env run db:migrate
```
> [!IMPORTANT]
> Never run `drizzle-kit push` or destructive migration scripts against development, test, or production databases. Always generate and inspect reviewed SQL migration files in `packages/db/migrations/`.

---

## 11. Security & Production Deployment Considerations

1. **Production Reverse Proxy (Caddy)**:
   - Expose only ports `80` and `443` via Caddy.
   - The Hono API and PostgreSQL database must never be bound directly to public network interfaces (keep `127.0.0.1` or private Docker network).
   - Caddy injects secure headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, and sets `Strict-Transport-Security`).
2. **Database Role Hardening**:
   - Run migrations with an administrative database user.
   - Run the API application with a restricted runtime database role (`runtime-permissions.ts`) possessing only `SELECT`, `INSERT`, `UPDATE` on non-immutable tables and sequences.
3. **Cookie Security**:
   - In production (`APP_MODE=live`), cookies must use `Secure; HttpOnly; SameSite=Lax` attributes.
4. **Attachments Storage**:
   - Uploaded files are stored in a private directory outside the public web root.
   - Files are served strictly via authenticated API proxy with random internal UUIDs and strict `Content-Disposition: attachment`.




how to run in local :::


1.cd /Users/divyagattani/Desktop/projects/codex
2.bun --version
3.nc -z 127.0.0.1 55432 && echo "Postgres is up!" 
(Verify PostgreSQL is running: On your machine, PostgreSQL is configured to listen on 127.0.0.1:55432)
4.lsof -i :3001 -i :5186 
Before starting, make sure ports 3001 (Backend API) and 5186 (Frontend Web) aren't already running in a background process:
5. kill -9 <PID>
If a process (PID) is listed and holding port 3001 or 5186, terminate it
6. bun --no-env-file --env-file=.env run db:migrate
Apply any pending reviewed SQL migrations to the local database
7. bun --no-env-file --env-file=.env run dev
Runs both the API (port 3001) and the Vite web server (port 5186) together
8. 👉 http://127.0.0.1:5186


credentials 
Owner	owner@demo.invalid	1234
Manager	manager@demo.invalid	1234


Porkbun.com 
username : divyaannapurna
password : DivyaAnnapurna@1123
Primary Email Address* : divyagattani111@gmail.com
Backup Email Address : srinivasgattani72@gmail.com
Company Name :Annapurna Sales Corporation
address : hyd
site : annapurnadivya.co.in

oracle cloud ::

email/Username : srinivasgattani72@gmail.com
password : DivyaAnnapurna@1123
cloud account/tenancy name : srinivasgattani72
Reference Number : 0e39840c
Tenancy id : ocid1.tenancy.oc1..aaaaaaaafgzquwfgt6zmvzq7esu4cx5ivfp6b4g7lyluoxqy625guysk5rga

how to deploy to prod 

Step 1: On your Mac (normal Git workflow)

Whenever you finish changes on your Mac:

bash
git add .
git commit -m "your update message"
git push origin main



step 2 : Deploy on the server with 1 command

ssh -i ./ssh-key-2026-11-24.key ubuntu@129.225.115.163 "cd annapurna && ./deploy.sh"

//// or  /////


Step 2: Log into your server

ssh -i ./ssh-key-2026-11-24.key ubuntu@129.225.115.163
cd /home/ubuntu/annapurna

Rebuild and restart the containers

# Rebuild the web and API images with your new code
docker compose --env-file .env.production -f infra/compose.yaml build

# Apply any new database migrations (if schema changed)
docker compose --env-file .env.production -f infra/compose.yaml --profile operations run --rm -e APPROVED_MIGRATION=yes migrate

# Restart the services with zero downtime
docker compose --env-file .env.production -f infra/compose.yaml up -d --wait api caddy

