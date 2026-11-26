# Codex project instructions — Family Sales Ledger

Before writing or changing code, read the **entire** `CODEX_APP_CONTEXT.md` in this repository. That file is the complete business, technical, security, accounting, and acceptance-test specification. It is larger than this short `AGENTS.md` deliberately. Keep requirements from that spec; do not silently replace them with default starter templates.

## Required stack
- Bun workspaces + Turborepo; TypeScript across frontend and backend.
- `apps/web`: React + Vite + TypeScript, responsive desktop-first, Tailwind + shadcn/ui-style controls, TanStack Query, ECharts.
- `apps/api`: Bun + Hono API, versioned `/api/v1`, Zod-validated shared contracts.
- `packages/db`: PostgreSQL 18 + Drizzle ORM + reviewed Drizzle Kit migrations, server-only.
- Docker Compose on Ubuntu LTS VPS, Caddy HTTPS, Vercel only if explicitly chosen.

## Non-negotiable business rules
- Each salesman personally owes the business for products billed to him; he is the debtor, not merely a delivery/collection agent.
- One recorded event per real transaction; bills, payments, returns, cash/bank transfers, loans and expenses remain distinguishable. Never double-count bank deposits as collections.
- **No JavaScript floating-point arithmetic for posted money**: use exact PostgreSQL NUMERIC and decimal-safe calculations/decimal-string APIs.
- Immutable/reversal-based posted ledger; atomic PostgreSQL financial commands; idempotency; concurrency safety; role checks; audit; verified-online-payment states; day closing.
- No invented product units/rates, opening balances, statutory tax rules or bank details. Use fictional demo data only until live setup is confirmed.

## Engineering approach
- Inspect existing files before editing and protect user changes.
- Make a short phased plan and implement usable vertical slices, not only a mock UI.
- Keep `ASSUMPTIONS.md`, a requirements/test checklist, reviewed SQL migration history, and working setup/deploy/restore documentation.
- **Mandatory verification rule**: Always run `bun run --filter @ledger/web build` (or Vite transform check) whenever frontend code (`apps/web`) is edited, BEFORE and IN ADDITION TO Bun unit & integration tests. Never report a change complete without validating that `apps/web` builds cleanly with zero JSX/syntax/transform errors.
- **Strict Git Rule**: NEVER run `git add`, `git commit`, `git stash`, or any git staging/committing commands under any circumstances unless the user explicitly and directly instructs to do so. All edits must remain as unstaged working directory changes so the user has full visibility and control over source control.
- Typecheck, lint, run Bun tests, PostgreSQL-backed integration tests and representative Playwright tests; report what actually ran and failed.
- Do not make production deployments, buy services, reveal credentials, or run destructive migrations/resets without authorization.

Codex model/effort is chosen in Codex settings. User preference: **GPT-6.1 Sol, Medium thinking**. This file cannot switch the active model.
