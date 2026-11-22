# Family Sales Ledger

A PostgreSQL-backed operational sales and money diary. A salesman is the debtor for his own bills. The app records money movements; it never sends bank payments. `CODEX_APP_CONTEXT.md` is the source of truth. Visual references are in `stitch_sales_money_book_pwa/`; their sample business data and accounting claims are not imported.

This is a development implementation with fictional data. Read [current status](docs/STATUS.md), [test evidence](docs/TEST_RESULTS.md) and the [55-case checklist](docs/ACCEPTANCE.md) before a live trial. Live posting requires a separately provisioned live business and explicit owner setup approval. No public deployment has been performed.

## Requirements

- Bun **1.4.4**; PostgreSQL **18**; Docker Compose for the recommended local/VPS setup.
- Node 22+ is useful for Playwright tooling. The API runs on Bun.
- Install Chromium with `bunx playwright install chromium` (Linux: `bunx playwright install --with-deps chromium`).
- PostgreSQL 18 client tools for the native backup/restore scripts; set `PG_BIN` if they are not in `/usr/bin`.

## Fresh local setup

```sh
bun install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

Edit `.env` privately. Set a random 32+ character `BETTER_AUTH_SECRET`, two 12+ character local demo passwords, and the database URL. Do not put secrets in `VITE_*` variables. The local origin is `http://127.0.0.1:5186`; use that exact host consistently for cookies.

Create a separate Compose environment file (ignored by Git) with a private `POSTGRES_PASSWORD`, then start only development PostgreSQL:

```sh
docker compose --env-file .env.compose -f infra/compose.dev.yaml up -d
```

Set `DATABASE_URL=postgresql://ledger:URL_ENCODED_PASSWORD@127.0.0.1:5433/family_ledger_demo` and `APP_MODE=demo` in `.env`.

```sh
bun --no-env-file --env-file=.env run db:migrate
bun --no-env-file --env-file=.env run db:seed:demo
bun --no-env-file --env-file=.env run dev
```

Open [the local app](http://127.0.0.1:5186). Sign in as `owner@demo.invalid` or `manager@demo.invalid` using the respective password you set privately. There is no public registration. The demo seed is repeatable through stable posting keys; it never resets a database. It refuses databases not ending `_demo`.

On the development machine used for this build, an ignored repository-local Bun executable is at `.tools/bun/bin/bun` and a separate native PostgreSQL cluster listens on **127.0.0.1:55432**. Its demo/test database names end `_demo` / `_test`. `.env` contains private generated local credentials. These are not deployment credentials. Add `.tools/bun/bin` to `PATH` if using that local runtime.

The explicit `--no-env-file --env-file=...` form avoids an automatic environment-file discovery hang observed on this Mac. It still loads the named file and passes environment variables to workspace tasks. Keep API/Web origins identical. API development binds loopback by default; containers explicitly use `API_HOST=0.0.0.0` on their private network.

## Checks

```sh
bun --no-env-file run typecheck
bun --no-env-file run lint
bun --no-env-file run build
bun --no-env-file run test
```

For PostgreSQL integration tests, create a **new separate** `family_ledger_test` database. Copy the local environment to a private `.env.test`, set that database URL, `APP_MODE=test`, and a distinct private attachment directory. The tests retain uniquely named test organizations and do not truncate or reset data. The in-process HTTP tests use `APP_ORIGIN=http://localhost:5173` consistently; set that in `.env.test` independently of the demo browser origin.

```sh
bun --no-env-file --env-file=.env.test run db:migrate
bun --no-env-file --env-file=.env.test run test:integration
bun --no-env-file --env-file=.env run test:e2e
bun --no-env-file --env-file=.env.test run test:performance
bun audit
```

Run browser tests against running demo API/Vite servers. Tests create fictional bills. Use a dedicated demo database for repeated browser testing. Performance fixtures add 10,000 fictional bills and 100,000 lines to the **test** database. They are bulk history fixtures, not a claim about command-posting throughput.

Stable scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate`, `db:seed:demo`, `backup`, `restore:drill`, `test:performance`, `format`.

## Layout and implementation

- `apps/web`: React/Vite, Tailwind, accessible native/shadcn-style controls, TanStack Query, lazy ECharts. No database imports or browser ledger persistence.
- `apps/api`: Hono/Bun, Better Auth database sessions, role checks, Zod validation, exact decimal calculations and transactional commands.
- `packages/contracts`: browser-safe Zod contracts; decimal amounts are JSON strings.
- `packages/db`: server-only Drizzle/pg, schema, generated/reviewed SQL migrations.
- `tests`: Bun calculations, PostgreSQL posting/concurrency/API tests, Playwright browser journeys.
- `infra`: VPS Compose/Caddy and local development PostgreSQL definitions.

Each financial command takes an `Idempotency-Key`. A PostgreSQL transaction and organization advisory lock cover source records, balanced journal, allocation generations, audit and saved response. Duplicate payload/key returns the same saved result; changed payload/key reuse conflicts. Posted records cannot be overwritten or deleted. See [data/posting map](docs/DATA_MODEL.md), [permissions](docs/PERMISSIONS.md), [API](docs/API.md), [manager guide](docs/MANAGER_GUIDE.md), [deployment](docs/DEPLOYMENT.md) and [backup/restore](docs/BACKUP_RESTORE.md).

## Before real records

Confirm identities, product units/conversions/rates, cutover/opening balances, cash custody, receiving accounts, role policies, printer format and statutory needs. Conduct a reconciled parallel trial, isolated restore drill and independent financial/security review. Backups need an approved encrypted off-server destination and monitoring; the app reports that monitoring as **Not connected**. Optional MFA, automatic bank feeds, full inventory, tax invoicing and offline posting are not enabled.
# annapurna
