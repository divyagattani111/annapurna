# Data model and posting map

## Source of truth

`documents` holds immutable numbered events, posting/actual dates, actor, exact amount and source snapshots. `bill_lines` snapshots product name, selling/base unit, conversion, price basis, rate and amount. Every event has balanced `journal` lines with `NUMERIC(18,2)` debit/credit. Quantities/rates/conversions use `NUMERIC(24,8)`. Decimal.js uses 60-digit precision and half-up line rounding. Money never travels as a JSON number.

`journal.account` is a stable internal dimension, e.g. `trade:<salesman UUID>`, `money:<cash/bank UUID>`, `loan:<loan UUID>`, `staff:<advance UUID>`, `borrowed:<loan UUID>`, `transit:<deposit UUID>` and `holding:<unidentified credit UUID>`. Composite foreign keys enforce organization scope. Journal triggers validate money/trade dimensions, positive single-sided lines and deferred entry balancing at commit. Ordinary HTTP clients cannot supply journal lines.

The app/database immutability triggers protect posted documents, lines, journal, applications, bank identities, price versions and audit. Infrastructure administrators remain privileged; this is not a tamper-proof storage claim.

## Entities

| Area | Tables / purpose |
|---|---|
| Business and access | organizations, Better Auth user/session/account/verification, members with server-side role/capabilities |
| Masters | salesmen, products, effective product_configurations, custody-specific money_accounts |
| Financial history | documents, bill_lines, journal, bank_identities |
| Payment claims | receipt_claims: pending / confirmed / rejected; confirmed document separate |
| Settlement | allocations append-only generations plus allocation_heads selecting current generation |
| Controls | periods, closes, reconciliations, idempotency, audit |
| Supporting work | versioned actor-scoped drafts, frozen approval requests, private attachments |

No editable outstanding/cash column is a balance source. Dashboard/statements/account books sum journals as of explicit business dates. Positive trade balance is due; negative is a separate advance. No cross-salesman netting. Historical statement balances include each original and its inverse once.

## Posting map

| Event | Debit | Credit |
|---|---|---|
| Bill | Salesman trade | Operational billed-sales control |
| Confirmed receipt | Actual cash/bank | Salesman trade |
| Return | Return control | Salesman trade |
| Credit refund | Salesman trade | Paying cash/bank |
| Expense | Classified expense | Actual payment legs |
| Internal transfer | Destination money | Source money |
| Deposit handed over | Transit | Physical cash |
| Deposit credit / return | Receiving bank / cash | Transit |
| Loan given / staff advance | Separate receivable | Money |
| Principal collected | Money | Separate receivable |
| Borrowing | Money | Borrowing payable |
| Borrowing repayment | Borrowing payable | Money |
| Salary with setoff | Full salary expense | Advance settled + actual net payout |
| Owner contribution / advance | Money | Explicit capital / payable classification |
| Owner withdrawal / repayment | Explicit capital / payable | Money |
| Unknown bank credit | Bank | Holding |
| Identify existing bank credit | Holding | Salesman trade (one or several assignments) |
| Opening | Signed target side | Opening clearing counterpart; no new sales/collections |
| Classified owner correction | Selected trade/money effect | Restricted correction control counterpart |
| Reversal | Exact original credits | Exact original debits |

## Atomicity, idempotency and settlement

Financial writes use one Drizzle transaction on the pg driver. A transaction-scoped organization advisory lock deliberately serializes this small business's financial writes, date closing and permission changes. Every constraint is rechecked under that lock. Membership/role is reloaded rather than trusting an Actor object or client field. Unique document sequence values are never reused (gaps are acceptable).

Idempotency stores a canonical payload hash and response in the same transaction as all effects. Rollback leaves no financial source/journal/application/audit/idempotency fragments. Retry after a lost response returns the committed result.

Allocation generations preserve history. Effective charges/credits are reconstructed excluding reversed sources for current settlement only; journal balances retain originals AND reversing entries. Returns first occupy the original bill's settlement capacity, then refunds consume available source capacity, then remaining sources settle charges oldest-first (with an optional reviewed preference). Allocation never moves cash. Existing refunds must keep source capacity; a return correction that would make previously refunded credit unavailable is blocked until its dependent refund is reversed.

Returns use original line snapshots; final quantity consumes any paise residual exactly. Product-master changes do not change old documents. An inactive salesman cannot get a new bill but can pay old dues.

Daily closing freezes the business date for posting, preserves expected/count/difference and never silently plugs a variance. Reopening marks affected later close and reconciliation snapshots stale. Reconciliation is manually supplied statement information, not a live bank connection.

## Reviewed migration history

- `0000_lush_purple_man.sql`: Drizzle Kit generated baseline, tables, FK relationships and uniqueness.
- `0001_integrity.sql`: additive sequence, financial checks, organization composite FKs, immutable-history and deferred balance triggers; reviewed against §16–19.
- `0002_balance_trigger_record.sql`: fixes polymorphic trigger-record access found by the first seed's rolled-back transaction. Original migration history is retained.
- `0003_query_indexes.sql`: indexes for commit checks, source lookups, verification queue and configuration history.
- `0004_salty_mordo.sql`: Drizzle-generated additive reconciliation stale-state field.
- `0005_opening_identity.sql`: prevents duplicate approved opening batch/row sources under different request keys.

No schema push, destructive migration, production migration or data reset was run. Review future generated SQL against these hand-authored integrity extensions; do not replace them with a schema push.
