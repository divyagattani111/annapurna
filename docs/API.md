# API overview

Bill lines now accept optional decimal-string `rate` and `basis` overrides and optional `discount: {type: "fixed" | "percent", value: "..."}`. Fixed discount is a whole-line INR amount with at most two decimal places; percentage permits eight places, capped at 100. Gross rounds half-up to paise before subtracting the fixed or rounded percentage discount. Discount above gross, nonpositive quantity/basis/conversion and negative rate are rejected. Client-calculated amounts/totals remain forbidden. No product master is changed.

Preview calculates edited bills without posting and returns `needsOwnerApproval`, effective rate/basis/unit, gross, discount and net amounts. Posting explicit edits requires owner status or the respective `editBillPrices` / `applyBillDiscounts` capabilities, checked before cached idempotency results as well. Owner-only `PATCH members/:id` accepts these optional booleans; omitted fields preserve existing grants. The review hash binds each line's price/basis/discount, even when compensating edits keep the total unchanged. Existing unposted reviews must be refreshed after this change.

Same-origin `/api/v1`, JSON request bodies, Better Auth session cookies, exact allowed Origin on mutations. Money/quantity/rate inputs and monetary responses use decimal strings. Opaque UUIDs identify business records. Zod objects are strict; unknown calculated fields are rejected.

## Read and setup routes

- `GET health` (readiness), `GET me`, `GET masters`.
- `POST salesmen`, `POST products` (new effective configuration), `POST accounts`; owner master deactivation via `PATCH masters/:type/:id`.
- `GET documents?kind=&search=&offset=`, `GET documents/:id`, `GET bill-lines`.
- `GET dashboard?asOf=YYYY-MM-DD`, `GET statements/:salesmanId?from=&to=`, `GET books/:accountId?from=&to=&offset=`.
- `GET reports/:name?from=&to=&offset=&format=csv`: outstanding, products, collections, expenses, loans, deposits, closes, reconciliation, claims, ageing. Current allocation-based ageing is explicitly today-only; historical journal statements remain available.
- `GET audit` owner; `GET export` operational register CSV; `GET portability-export` owner full financial/master/audit JSON without credentials/sessions/storage keys.
- `POST drafts`, `GET drafts`: actor-scoped, versioned server drafts. Financial posting can atomically consume a draft with `X-Draft-ID` and `X-Draft-Version`.
- `POST requests`, `GET requests`, `POST requests/:id/approve`: frozen, validated payload; approval and financial effects commit together. Repeating approval returns the same result.
- `POST attachments/:documentId`, `GET attachments/:id`: authenticated multipart evidence up to 10 MB, JPEG/PNG/PDF signatures only; private randomized files, no executable HTML/SVG, no public object paths. Malware scanning is not configured.
- Owner `PATCH business`, `POST business/approve-live`, `GET/POST members`, `PATCH members/:userId`, `POST members/:userId/reset-password`.

## Financial commands

`POST commands/:name` accepts a required `Idempotency-Key` (16–200 characters). Contracts and all accepted fields are in `packages/contracts/src/index.ts`. Reviewed command names: bill, receipt, receiptBatch, verify, reject, return, refund, opening, openingBatch, expense, transfer, deposit, resolveDeposit, loan, repay, salary, owner, unidentified, identify, reverse, close, reopen, reconcile, reallocate, adjustment.

`POST preview/bill` calculates a nonposting review from current confirmed prices and returns a `quoteHash`. External bill commands and frozen bill approval requests must include it as `expectedQuoteHash`. Posting checks it under the financial lock. A changed balance, configuration, or policy returns `STALE_REVIEW` (409) and requires review again; retrying a committed key still returns the original result. A manager's credit-limit exception is a frozen owner-approval request, not a client override.

`POST opening-import/preview` validates approved total-balance import rows without posting. The final openingBatch is atomic; stable batch/row identity prevents duplicate openings. Legacy invoice-item import is deliberately blocked rather than guessing ages or loading both total dues and old invoices.

Dashboard, individual document, statement, account book and bill-preview multi-query reads use read-only repeatable-read snapshots. The report screen exports the exact displayed server values with shared CSV escaping, following an authenticated `POST report-export-audit` request. Its CSV remains tied to the displayed page if another transaction posts meanwhile. Direct `GET reports/:name?...&format=csv` performs a fresh query instead.

Owner `PATCH salesmen/:id` manages contact, activation and credit limit. Business setup includes document prefix/start; numbering configuration locks after the first posting. `commands/resolveCloseException` records an owner's explicit recount confirmation or linked real correction without silently creating an expense.

Example receipt request (IDs must be real records in the authenticated business):

```json
{
  "date": "2026-11-06",
  "actualDate": "2026-11-06",
  "salesmanId": "<salesman UUID>",
  "accountId": "<physical cash UUID>",
  "amount": "4000.00",
  "method": "cash",
  "reference": "",
  "verified": false,
  "note": "Cash actually received"
}
```

Pending online claims return a claim ID/state with no journal. Confirmation returns a separate receipt document ID/number/amount. Stable errors include VALIDATION, FINANCIAL_VALIDATION, FORBIDDEN, NOT_FOUND, DATE_CLOSED, IDEMPOTENCY_CONFLICT, DRAFT_CONFLICT and LIVE_SETUP_REQUIRED. Unexpected errors return no stack trace or financial payload. A network failure is not proof of rollback; retry the same key.

Document register pages contain at most 50 records, generic reports/books at most 100, and statements require ranges of at most 1,000 entries. Full portability export is explicitly a bulk owner operation, not a dashboard query.
