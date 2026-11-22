# Family Sales Ledger — Codex Build Specification

**Version:** 2.0 | **Updated:** 6 November 2026 | **Currency:** INR | **Business timezone:** Asia/Kolkata  
**Development agent:** OpenAI Codex (user preference: GPT-6.1 Sol, Medium thinking) | **Status:** Requirements and build specification; app not yet implemented

## 0. Instructions to Codex and the implementation agent

**Agent choice:** Use OpenAI Codex as the implementation assistant. The project owner intends to select **GPT-6.1 Sol with Medium thinking** in their Codex environment. This document records the preference; a repository file cannot select a model or reasoning-effort setting. If the displayed model label differs, do not silently claim that a particular model is active. No Google Antigravity-specific workflows, tooling, or references are required.

**Source-of-truth hierarchy:** confirmed business facts and financial rules in this document → documented owner-approved changes → architectural defaults in this document → implementation choices recorded in `ASSUMPTIONS.md`. If an existing repository contains code, inspect it before modifying anything. Preserve correct existing features and user data.

**Codex project setup:** put this full specification in the repository root as `CODEX_APP_CONTEXT.md` (the updated `ANTIGRAVITY_APP_CONTEXT.md` download is also identical). Put a **short** `AGENTS.md` in the repository root instructing Codex to read the entire specification. Do not paste this large document into `AGENTS.md`: Codex has a project-instructions size limit, and the full specification is longer than the default budget [R11]. The model setting is chosen in Codex, not through AGENTS.md.

**Recommended implementation behavior:** read this whole file before architectural work; inspect the repo and current status; give a short plan; work in small vertical slices; run type checks, tests, and migrations against a development database; record decisions and test evidence; do not stop after delivering only a plan. Implement in the ordered phases in §22. Each completed feature must be demonstrably usable with a real PostgreSQL development database.

Build a genuinely usable, database-backed web application from this document. This is an operational sales-and-money diary for a small, family-owned business, not a public e-commerce store and not a full enterprise accounting package. The main challenge is reliable records with a simple interface, not elaborate graphics.

Read the whole document before designing the schema. Treat the confirmed facts below as requirements. Treat proposed defaults as implementation decisions that the owner can change. Do not invent missing business facts, real product prices, pack conversions, tax rates, bank details, opening balances, or salesman names. Use clearly fictional demo data in a separate development environment.

Do not stop at a dashboard mockup, plan, or frontend with local-storage data. Implement and test the complete first-version workflows, real persistence, access control, calculations, corrections, reports, and deployment instructions. Work in small, testable stages. Keep a requirements-to-tests checklist. A feature is not complete merely because its button exists.

For questions that are not essential to safely building the software, use the stated default, record it in ASSUMPTIONS.md, and proceed. For financially significant unknowns, build the configuration interface and block the affected live operation until the owner confirms its settings. This must not block demonstration with fictional, valid configurations.

Do not deploy publicly, purchase services, send messages, connect bank accounts, change external financial records, delete unrelated files, or run destructive production migrations without explicit authorization. The application records transactions; it does not initiate bank payments.

## 1. Confirmed business context

The owner's child is organizing this app to help their father. The father owns the business. A manager works under him, and approximately 12 salesmen take products from the business. The number 12 is the current situation, not a hard-coded limit.

**Critical confirmed fact: each salesman personally owes the owner/business for the products billed to him.** This is not a delivery-agent model where the business must track the individual shops visited by the salesman. Do not create customer-shop receivables or treat salesmen as mere collectors in version 1.

Salesmen can pay the full amount, pay part immediately and the rest later, or pay later in multiple instalments. Payments can be cash, online, or a combination. One payment may relate to old bills, several bills, or an advance for future products. The manager currently records bills, payments, outstanding dues, bank deposits, loans/borrowings, diesel, salaries, and miscellaneous money movements in notebooks and later tallies them.

The manager can use a computer but is not an advanced computer user. The user has already discussed and understood the process with the manager. Do not require photos of the manager's personal notebooks or ask the user to repeat that discovery exercise before building.

The desired app should be simple, pleasant, easy to learn, and precise. The manager should enter what happened once; the app should calculate its consequences. The owner should be able to understand the business without reconstructing handwritten notes.

A sample paper bill/order-book photo was supplied. Its printed heading reads “Annapurna Sales Corporation.” It contains a serial number, date, person's name, product rows/abbreviations, quantities, a “Rate Per ‘M’” column, amounts, and a total. Use its familiar layout as inspiration, not as verified opening data. Some handwriting and unit conventions are ambiguous. Do not infer the meaning of “M,” actual pack sizes, tax treatment, quantities, prices, or balances from the image. Do not publish the photo, its identifying details, or real business data in a public repository.

## 2. Proposed defaults and unresolved configuration

These are implementation defaults, not additional facts supplied by the user.

| Topic | Default for building | Required before relevant live use |
|---|---|---|
| Format | React + TypeScript + Vite responsive web app; desktop-first manager interface, mobile-friendly owner interface; optional installable PWA | Confirm actual devices and printer during trial; native Android APK not in scope |
| Organization | One business, one location | Editable business profile; avoid multi-branch complexity |
| App label | “Sales & Money Book”; business name editable | Owner chooses display name and confirms business details |
| Currency/time | INR; Asia/Kolkata; Indian digit grouping | Owner confirms settings |
| Language | Simple English; support Unicode names and translation-ready labels | Add Telugu or another language only when requested and reviewed |
| Accounts | One main physical cash account and configurable business bank accounts | Actual names, custody, cutover balances, and opening dates |
| Users | Owner and manager logins | Owner invites manager; no public sign-up |
| Salesmen | Account records only; logins not required | Actual names and agreed opening dues/credits |
| Allocation | Oldest eligible outstanding charge first | Owner can change policy; allocation details stay visible |
| Due dates | Optional; no automatic interest | Agreed credit terms, if any |
| Credit limits | Disabled unless configured per salesman | Owner-approved limits and override policy |
| Prices | Saved product prices; manager changes only when permitted | Confirm units, price basis, conversion, and final selling prices |
| Invoice rounding | Keep paise; no whole-rupee round-off by default | Owner may enable an explicitly shown rounding policy |
| Online receipt | Pending until manually verified by authorized user | Verified receiving account and evidence/reference policy |
| Stock | Product quantities billed/returned only; no available-stock claims | Full inventory is a separate scope decision |
| Tax | Operational ledger/document mode; tax configuration absent, not assumed 0% | Accountant-approved requirements before replacing statutory invoicing |
| Network | Online posting; visible unsaved drafts and safe retry | Do not pretend offline entries have reached the server |
| Charts | Apache ECharts for optional owner dashboards; tables remain authoritative | Charts must use the same confirmed, server-calculated figures as reports |
| Hosting | Docker Compose on Ubuntu LTS VPS with HTTPS via Caddy; Vercel optional for the static frontend | Owner approves provider, domain, backups, and operating costs |

Build a setup checklist for the live-use requirements. Demo mode must remain available independently. Do not ask a long questionnaire before implementing the configurable system.

## 3. Scope of the first usable version

Include salesman accounts, product/rate setup, bills, partial and split payments, advances, bill allocations, linked product returns, credit refunds, operating expenses, salary payments and simple staff advances, loans given, money borrowed, loan repayments, cash/bank transfers, cash deposits in transit, owner funding/withdrawals, opening balances, daily cash closing, basic bank reconciliation, statements, printing, export, audit history, permissions, and backup/restore procedures.

This does not require a full payroll system, general tax engine, purchase-order system, supplier-credit ledger, inventory costing, profit-and-loss accounting, customer-shop ledger, commissions, GPS tracking, delivery routing, loyalty programme, e-commerce, AI assistant, OCR billing, automatic bank feeds, WhatsApp automation, payment gateway, native mobile applications, or multi-company SaaS. Do not implement these by default. Create clean extension points instead.

**Do not display “profit.”** Product costs, complete purchases, stock valuation, tax treatment, and all relevant expenses have not been defined. Sales, collections, expenses, loans, and balances can be reported without pretending to calculate profit.

## 4. Roles and permissions

Apply permissions on the server/database, not just by hiding buttons. The owner is the business administrator, but even the owner must not silently overwrite posted financial history through the app.

| Action | Owner | Manager | Optional future salesman login |
|---|---|---|---|
| View operational records and all salesman balances | Yes | Yes | Own account only |
| Create/post standard bills on an open business date | Yes | Yes | No |
| Record cash receipts actually received | Yes | Yes | No; may submit a claim later |
| Verify online receipts against receiving-account evidence | Yes | Yes by default; owner can revoke | No |
| Record normal expenses from authorized business accounts | Yes | Yes | No |
| Record transfers/deposits and verify deposit credit | Yes | Yes within permitted accounts | No |
| Record linked returns at original prices within returnable quantities | Yes | Yes on an open date; audited | No |
| Issue refunds to salesmen | Yes | Draft/request only by default | No |
| Post lending, borrowing, owner movements, staff advances | Yes | Draft/request only by default | No |
| Pay regular salaries from configured categories | Yes | Yes; no payroll calculation | No |
| Change product prices, units, price basis, or discount policy | Yes | Only expressly enabled capabilities | No |
| Create a salesman | Yes | Yes; no opening balance authority | No |
| Set/finalize opening balances, credit limits, or free-form adjustments | Yes | Draft preparation only | No |
| Reverse a posted financial entry or reopen a closed date | Yes, with reason | Request only | No |
| Close today's cash book | Yes | Yes | No |
| Manage users, full audit export, backup/restore and security settings | Yes | No | No |
| Delete posted records or erase audit trail | No app capability | No | No |

These are proposed safety defaults. Expose owner-controlled capabilities where helpful without allowing users to elevate their own permissions. A manager request must not cause a financial posting until it is approved and the real transaction is recorded. Show requests separately; do not treat them as completed money movements.

Do not assume the salesmen are employees merely because they are called salesmen. Staff salary records and debtor accounts are different concepts. A person may have both roles, but balances must remain distinguishable.

## 5. Navigation and experience

Use React + TypeScript + Vite, with Tailwind CSS and shadcn/ui-style accessible components as the proposed UI approach. Use a restrained, warm, professional light theme, clear typography, good contrast, modest rounded corners, and minimal animation. “Simple and cute” should not become toy-like or visually busy. Prefer readable labels to unexplained icons. A compact sidebar and predictable forms are appropriate for the manager's computer.

Suggested navigation: Home; Salesmen; Bills; Receive Money; Other Money; Cash & Bank; Reports; Settings. Put Products in Settings or a readily accessible secondary menu. Daily Close should be a prominent action from Home and Cash & Bank. Manager and owner can have different home views without maintaining two unrelated applications.

Support keyboard navigation, tab-through billing rows, searchable selectors, visible focus, numeric entry, clear date selection, and an accessible layout. Do not require a mouse click for each quantity. Avoid accidental posting when Enter is pressed inside a numeric field. Clearly separate “Save draft” from “Save bill”/“Confirm payment.” Use a review step for financial posting.

Use plain language: “Still to receive,” “Paid in advance,” “Cash in hand — book balance,” “Payment awaiting verification,” and “Cash counted.” Explain accounting terminology when it cannot be avoided. Show clear empty, loading, failure, pending, and successful states. Preserve a draft after validation or network failure; never show “Saved” before the server confirms it.

Use DD MMM YYYY in human-facing dates, with full dates in confirmations; ISO dates in exports and APIs. Display rupees with paise when relevant and Indian grouping, e.g. ₹1,25,000.50. Do not concatenate currency symbols into stored numeric values. Do not abbreviate money as “1.2L” on entry/review/statement screens.

Desktop entry should work comfortably at 1366×768. Owner dashboards and statements must work on a roughly 360-pixel-wide phone without losing important totals. Keep wide billing grids usable by prioritizing fields or controlled scrolling. Never hide important fields only to fit a phone.

## 6. Home screens and record definitions

### Manager home

Show today's posted bills amount, confirmed cash collections, confirmed online collections, expenses, transfers, expected physical cash by custody account, pending online payments, and daily-close status. Include New Bill, Receive Payment, Record Expense, Deposit/Transfer, and Close Today actions. Display the business date and latest data refresh time. Use exact filters behind each card.

### Owner home

Show gross money still to receive from salesmen, total salesman advances/credits separately, person-wise dues, today's billed sales and returns separately, confirmed collections by method, cash and bank book balances by account, loans outstanding in both directions, unverified payments, unsettled deposits, close differences, and recent reversals/overrides.

Do not offset one salesman's advance against another salesman's dues in the headline receivables card. Clicking a card opens its filtered transactions and as-of date. Do not mix a daily activity total with an all-time balance without saying so. Optionally show Apache ECharts views of collections by cash/online, oldest outstanding dues, receivables ageing, and operating expenses; label time range and payment-status filters, use only server-derived aggregates, provide accessible tables/drill-downs, and never show invented demo charts as live business data.

A bank book balance is the app's recorded balance, **not a live balance fetched from the bank**. Show last reconciliation date and difference if supplied. A cash balance is also a book balance until counted. An amount described as “received” must correspond to a confirmed receipt, not a pending payment claim.

## 7. Master data and opening setup

### Business and money accounts

Store editable display/legal name, address, optional confirmed identifiers, contact details, business timezone, currency, document series, allowed payment methods, close policy, and print footer. Do not copy an uncertain identifier from the sample photograph into production.

Each money account needs an ID, display name, type (physical cash or bank), custody/holder, active flag, and optional masked bank details. Distinguish payment method from destination: UPI is a method; a particular bank account is where the funds are received. Avoid duplicate “UPI cash” or wallet balances that duplicate a bank balance. No bank login credentials are needed.

Model deposits/transfers in transit and unidentified receipts with separate system accounts. Owner-held business cash can be a separate physical cash account when the funds remain business-owned; this is not automatically an owner withdrawal.

### Salesmen

Store ID, unique readable code, full/display name, optional phone/route/address/notes, active flag, optional credit limit, optional payment terms, and opening-balance references. Search by name or code. Do not require email or a login. Allow more than 12. Deactivation prevents new bills but must not prevent collecting old dues, recording valid corrections, or viewing history. Never delete a referenced salesman.

### Products and prices

Store ID/code, full name, familiar abbreviation/alias, display order, active flag, base unit, supported selling units, conversion factors, whether fractional quantities are allowed, price basis quantity, price, and price effective date. Keep rate history. An owner must confirm the unit/conversion/pricing configuration for each live product before it can be billed.

Do not silently reinterpret an abbreviation as a brand or product. Demo products must be fictional. Unit changes must create a new effective configuration and must not change historic documents. The regular products can appear in the order used in the paper bill.

### Cutover/opening balances

Choose a live cutover date. Before first live posting, the owner approves each salesman's signed opening balance (amount owed or advance), physical cash, each bank balance, loans given and borrowed, staff advances, and any transit/unidentified items.

A positive opening salesman balance means he owes the business; a negative one means the business holds a credit/advance for him. Record opening entries explicitly, not as fake sales or fake payments. Use an opening-clearing counterpart in the internal journal. Track who prepared and approved each balance, evidence/reference, and notes.

For opening dues, optionally import older bill-level items so age and allocations remain meaningful. Otherwise create a clearly labelled Opening Due item, with age “unknown before cutover” unless a trustworthy original date is supplied. Do not invent an age. Never load both a total opening due and the same legacy bills again.

Unresolved opening differences must be flagged for owner approval; do not silently guess them. Import supports preview, validation, duplicate detection, dry run, error rows, and idempotent batch IDs. Finalized opening balances cannot be edited like profile fields. Later corrections require approved ledger adjustments.

## 8. Create a bill

The manager selects the salesman, sees his present balance, chooses a business date (today by default), enters products and quantities, reviews prices and totals, optionally records payment received now, and posts or saves a draft.

Required header: salesman, effective business date, generated document number at posting, recorded-by user, and optional note/paper reference. Drafts have temporary IDs and no financial effect. A posted bill represents products sold to that salesman and increases his dues, regardless of whether he has paid.

Billing rows: product code/name/alias, quantity, selling unit, conversion/price basis context, suggested rate, any authorized discount, and calculated amount. Blank rows are ignored and omitted from printing. Use quick quantity entry for regular products. Reject zero/negative selected-row quantities, missing prices, unconfirmed conversions, disallowed fractional quantities, negative rates, or discounts beyond permitted bounds. Normal sales rows cannot have negative amounts.

Keep this pricing formula explicit:

    base_quantity = entered_quantity × units_per_selling_unit
    unrounded_gross = base_quantity ÷ price_basis_quantity × rate_per_basis
    gross_line_amount = round_half_up(unrounded_gross, 2)
    line_amount = gross_line_amount − approved_line_discount
    bill_amount = sum(line_amount) + separately displayed rounding_adjustment

Numeric inputs may accept plain decimals or well-formed Indian-grouped values such as 1,25,000.50; normalize them explicitly. Reject ambiguous abbreviations, malformed separators, NaN/infinity, or blank required values rather than converting them to zero. A leading zero in a quantity must not change its numeric meaning. Repeated product rows may remain separate when units/rates/discounts differ; any merge must preserve the exact total.

Rates and conversion factors may have more than two decimal places; final money postings have two. Default rounding adjustment is zero. No hidden rounding and no floating-point currency arithmetic. If discounts are not enabled, omit the control rather than making the manager enter zero repeatedly. Keep any enabled fixed/percentage discount calculation deterministic, capped at the line's gross amount, and tested.

Example using fictional units, not the supplied photo: 2 boxes × 10 base units per box, priced at ₹250 per 100 base units, equals ₹50.00. A different product may be priced per single unit. The printed “M” must never silently become a hard-coded multiplier.

Store snapshots of product description, units, conversion factor, rate, price basis, discounts, and amount on the posted line. Future master-price changes must not alter old bills or returns.

The saved bill and any accompanying receipts are separate linked records. If the manager enters cash and online payment together, create distinct receipt rows with their own account, method, amount, and verification state. Posting the bill and its requested child records must be atomic. A pending online receipt is saved but has no financial effect.

The review screen clearly separates Previous Account Balance, This Bill, Confirmed Payments Entered Now, Pending Payments, and New Account Balance. “Received with this entry” is not necessarily “Applied to this bill”: payment allocation may settle older dues first.

No hard-coded due date or interest. If the owner has enabled a credit limit, assess the projected signed balance after the bill and confirmed same-batch payments; ignore pending payments. A limit violation requires owner approval before posting. An unset limit means no limit policy, not a limit of zero. Keep credit-limit headroom separate from money paid in advance.

## 9. Receive money, verification, and allocations

The Receive Money form asks: who paid (salesman), amount, payment method, actual receiving money account, business posting date, actual payment date if different, reference where available, optional attachment, and note. Cash can be confirmed only after the authorized recipient has received it. A payment claimed by a salesman is not confirmation of receipt.

Allow several receipts against one bill, one receipt across several bills, and receipts before future bills. Never create another sale when recording a payment. Do not require a new bill merely to accept old dues.

Online receipt lifecycle: Draft → Pending verification → Confirmed/posted OR Rejected. Pending records appear in a queue but do not reduce dues, increase a bank book balance, or count as collections. The verifier checks the receiving-account evidence, records reference/verification details, and confirms once. Confirmation creates exactly one financial posting. Rejection requires a reason and creates no posting. A previously confirmed payment that later fails must be reversed, not changed to rejected retrospectively.

Allow the authorized manager to confirm immediately when the receiving account has already been checked. A screenshot alone must not automatically verify anything. Do not claim the app checks a bank or UPI network without an implemented integration.

For a genuinely received bank credit whose payer is unknown, an authorized user can record an Unidentified Receipt: increase the bank account and an unidentified-receipts holding balance, but do not reduce any salesman's dues or count it as sales. Later identification reclassifies that existing receipt to the salesman without adding the bank money a second time. Preserve the bank transaction identity.

Reference-based duplicate detection must use the receiving account and bank transaction identity; do not reject every payment merely because amount and date match. Warn about suspicious repeats. A real bank credit can be recorded financially only once. If a bank credit must be split across people, use one bank-receipt parent and explicit child allocations whose total does not exceed it; never bypass uniqueness by recording the same transfer twice. A manager-friendly single-salesman receipt remains the normal path.

Default allocation is oldest eligible charge first, ordered by effective date and stable ID/number, including any opening due. Permit a reviewed allocation to specific bills within the same salesman account. No cross-salesman application. Automatically apply available advance/credit to newly posted charges. After any explicitly selected allocations, apply the remaining eligible credit to remaining charges in the default order; do not leave an artificial advance alongside collectible dues merely because the user selected one bill. A future disputed-item hold would require a separately defined workflow. Overpayments become an explicit available credit; they are not discarded or shown as unexplained negative dues.

Allocation is an explanation of settlement, not another cash movement. Save allocation history and make changes auditable. The sum applied cannot exceed the credit source's amount or the remaining collectible charges. Changing which bills a receipt settles must not change total cash, bank, or salesman net balance.

## 10. Salesman account and balance rules

Each account page shows: net money still to receive, available advance/credit, any enabled credit limit, bills, receipts by status, returns, refunds, opening balance, running statement, and an optional separate linked loan/advance section. Main actions are New Bill, Receive Payment, and Record Return.

For a given as-of posting date, define signed salesman balance B as:

    B = signed opening balance
        + posted bills
        + approved debit adjustments
        + confirmed refunds paid to this salesman
        − confirmed receipts/identified receipts
        − posted return credits
        − approved credit adjustments
        + the exact inverse effects of any reversals

When calculating from journal history, include each original posting and its reversing posting exactly once. Do not both exclude the original and subtract its reversal, which would reverse the effect twice.

Positive B means the salesman owes the business; negative B means available credit/advance; zero means settled. The ledger is the source of truth. Never let a user type a new outstanding balance directly into a profile. Loan principal involving the same person remains in a separate loan ledger unless an explicit owner-approved cross-settlement is implemented.

For the all-salesmen dashboard:

    total still to receive = sum(max(B, 0))
    total salesman credit  = sum(max(−B, 0))

Do not subtract the second number from the first and call the result “total outstanding.”

For bill settlement, represent charges and credit sources with explicit applications. Credits include receipts, opening advances, approved adjustments, and linked return credits. Credits can be applied, remain available, or be consumed by an authorized refund. Enforce amount conservation and keep the account equation above consistent with the unsettled items.

Bill lifecycle and payment status are separate: lifecycle Draft/Posted/Reversed; settlement Unpaid/Part-paid/Settled. “Settled” must indicate whether settlement was by money, returns/credits, or a combination. A bill settled only by a return must not falsely say that cash was paid.

Statements include opening balance for the selected range, date, record number/type, amount increasing dues, amount reducing dues, payment method/account where relevant, and running balance. Pending records appear in a separate section. Ending balance must match the account page for the identical as-of date and filter.

## 11. Returns, refunds, and corrections

### Product returns

A normal return selects the salesman, original bill and line, quantity, reason, date, and goods condition/note. Use the original line's price, unit conversion, and applicable discount basis, not today's price. Total returned quantity cannot exceed sold quantity less earlier effective returns. For rounding, cap cumulative return value at the original eligible line value; the final return of the remaining quantity consumes any rounding residual so a full return precisely reverses the original eligible value.

Posting a valid return creates a credit document and reduces the salesman balance. It does not create a cash payment. Quantity reporting records returned goods, but without full inventory setup it must not claim a trustworthy available-stock balance.

Apply a return credit to its original invoice first. When that invoice is already paid, release/reallocate enough earlier payment application to make room for the return credit; the released money credit becomes available or applies to other dues. Do not create two credits for the same return. Preserve the allocation changes and effective dates. An owner-approved opening-period return with no app bill needs supporting details and an explicit exception path, not an invented original invoice.

### Refunds

Returning goods and paying money back are different actions. A refund needs owner approval, a salesman with available refundable credit, amount, payment method, actual paying account, date, reason, and underlying credit sources. A pending refund request has no financial effect. A completed refund decreases cash/bank, consumes available credit, and increases the signed salesman balance toward zero. Do not refund more than available credit through this workflow and do not automatically send funds.

### Errors and cancellation

Drafts may be edited or removed under role rules. Posted financial content cannot be overwritten or hard-deleted. An authorized correction uses a linked reversal and replacement or a clearly classified correcting adjustment, with reason, actor, timestamp, and affected records. Keep original numbers visible and never reuse them.

Cancelling/reversing a paid bill must not delete its real receipts or pretend money was refunded. Remove/reallocate the bill's applications and leave the receipts as credit against other dues or an available advance, unless a separate real refund is recorded. Reversing a receipt reverses the cash/bank and dues effects and reopens affected charges once. Reversing a return/refund must also undo its applications safely. Block inconsistent reversals or provide an explicit dependency-aware correction workflow.

Free-form debit/credit adjustments, write-offs, discounts outside policy, receipt reassignment to another salesman, and opening corrections are owner-only, require a reason/category, and preserve links. Do not use a generic “adjust balance” field as an escape hatch. A payer reassignment must preserve the identity of the real cash/bank receipt: reverse/reclassify its trade-account effects and allocations, not credit the bank a second time. Retain both the mistaken and corrected attribution in the audit history.

## 12. Other Money: expenses, salaries, loans, and owner money

Use one friendly starting screen: What happened? How much? From/to which money account? Who or what was it for? On what date? Then display only the fields relevant to that type. Internally, keep each type distinct. “Miscellaneous expense” is a true operating-expense category, not a bucket for loans, transfers, receipts, or owner drawings.

### Expenses

Initial editable categories may include diesel/fuel, salaries, rent, electricity, transport, repairs, stationery, and miscellaneous. Require amount, category, paying business account, business date, and recipient/description as appropriate. Add optional voucher/reference and attachment. Show “Other” only with a description. Record completed expenses, not future intentions, in the money book. A non-business personal withdrawal is not an operating expense.

A payment split across cash and bank has explicit payment legs totaling the expense. Do not silently take the total from both. Reimbursements and personally funded business expenses need an owner-approved, explicitly classified funding/payable entry; do not pretend they came from business cash. Do not add a general supplier-credit system in this version.

### Salaries and staff advances

Support recording actual salary payments with employee/payee, salary period, amount, paying account, and note. This is not attendance, payroll-tax, payslip, or salary-computation software.

A staff advance is a separate receivable, not immediately salary expense. If a ₹2,000 advance is later set off against a ₹5,000 salary, record ₹5,000 salary expense, ₹2,000 advance settlement, and ₹3,000 actual cash/bank payout. Do not deduct ₹5,000 from cash or record the advance as a second salary expense. Keep outstanding advances per person and prohibit over-settlement.

### Loans given and money borrowed

Give each loan a direction, counterparty, principal, disbursement/receipt date, actual money account, optional due date, and note. Installment repayments reference the loan. Loans given and borrowings are not sales and principal repayments are not operating income/expense.

Loan given: cash/bank decreases and loan receivable increases. Repayment received: cash/bank increases and loan receivable decreases. Borrowing received: cash/bank increases and loan payable increases. Borrowing repaid: cash/bank decreases and loan payable decreases. Prevent principal repayments above the outstanding principal unless a separate, explicitly approved interest/fee component explains the difference.

Interest calculation is not automatic in version 1. An actual interest/fee component must be recorded separately under the correct owner-approved category; do not label the entire repayment as an expense. Never automatically offset a person's trade dues against their loan or staff advance.

### Owner movements

Owner funding is either a contribution or a repayable owner advance, according to the owner's explicit choice; it is not sales revenue. Taking money out for personal use is an owner withdrawal or repayment as classified by the owner, not diesel/miscellaneous expense. Handing business cash from manager to owner while it remains business-owned is an internal custody transfer, not a withdrawal. Require that distinction instead of guessing.

## 13. Cash, bank, deposits, and reconciliation

Every actual money movement must identify a cash/bank/custody account. Do not add a generic “online money” balance on top of a receiving bank account. Do not mix multiple bank accounts or multiple cash holders into one unexplained balance.

For a fully confirmed transfer between business accounts, post both sides atomically: decrease source, increase destination, unchanged total business money, and no new sale, collection, expense, or loan. Source and destination must differ. Amount must be positive.

For a cash deposit awaiting bank credit, use two stages:

    Cash handed over: Cash decreases; Deposits In Transit increases.
    Bank credit confirmed: Bank increases; Deposits In Transit decreases.

Support explicitly recorded partial deposit credits/returns: each credited portion moves only that amount from transit to bank, each physically returned portion moves only that amount from transit to cash, and the residual remains in transit. Total credited plus returned amounts must not exceed the original deposit, including under concurrency. Show Pending, Partially Resolved, Credited, Returned, or Resolved (Mixed) as appropriate.

A returned/failed deposit moves transit money back to the actual receiving cash account. Do not reduce any salesman's dues when crediting a deposit. A direct same-day transfer is allowed when both stages are already confirmed; it must still have one traceable transfer identity. Distinguish “cash physically in hand” from money in transit.

Show an account ledger with opening balance, inflows, outflows, running balance, transfers, and reconciliation information. Negative physical cash is a validation error for normal posting; do not invent an overdraft on a cash drawer. Explain missing opening/earlier entries and offer an authorized correction route. Bank overdraft support, if required, needs an owner-configured policy rather than assuming every bank account can go negative.

Basic bank reconciliation lets an authorized user enter a statement balance/date, mark app transactions matched, record references, and see unmatched entries and the difference. Do not automatically plug a difference into income or expenses. Record a real omitted bank charge under its own category only after review. Do not pretend a manually entered statement balance came from a live API.

## 14. Daily close and date controls

For each physical cash account/custodian, compute:

    Expected closing cash = prior book closing balance
                            + all posted cash inflows
                            − all posted cash outflows
    Cash difference = physically counted cash − expected closing cash

Cash inflows can include salesman receipts, loan repayments, borrowings, owner funding, and inbound custody transfers. Cash outflows can include expenses, loans given, repayments, refunds, owner withdrawals, outbound custody transfers, and bank deposits. Online receipts do not affect physical cash. Transfers between physical cash accounts affect each account but not combined business cash.

The manager reviews today's activity, pending online claims, unsettled deposits, prior exceptions, and expected cash; enters actual counted cash (optional denomination helper); and confirms close. Zero difference is matched. Nonzero difference requires an explanation and creates an owner-visible unresolved exception. Never create a silent balancing entry. Permit “closed with unresolved difference” only with a clear warning and approval policy; closing is not proof that the difference was fixed.

Use book closing as the next day's book opening. Do not silently replace it with counted cash. Carry the unresolved exception visibly until an actual error is corrected or an owner-approved cash-over/short adjustment is posted. Such an adjustment needs its own date and category; it is not an unrecorded edit to opening cash.

Closing freezes posted financial changes for that business date. The owner may reopen with a reason, but all affected later cash-close/reconciliation snapshots must be marked stale and recomputed/re-approved, retaining earlier versions. A simpler default is a linked correction on the current open date, preserving historical closed totals. Do not secretly rewrite yesterday's statements.

Store actual payment/event date, effective posting business date, created_at, posted_at, and verified_at where relevant. Use server timestamps for audit events. Timestamps are stored in UTC and displayed in business timezone; business dates are explicit date values. Managers normally post on the current open date. Owner-authorized backdating must obey period locks.

A payment reportedly made yesterday but verified after yesterday closed defaults to posting on the current open date, with yesterday retained as the reported actual payment date. Owner-approved historical posting requires the reopening process. Display both when different so neither date is misleading. Future-dated drafts are allowed; future completed financial postings are not a normal manager action.

## 15. Reports, search, printing, and export

Required reports are the salesman outstanding summary; individual running statements; bill register with settlement status; confirmed collections by method/account; pending/rejected online payments; product quantities billed and returned; expenses by category; cash/bank account books; bank reconciliation exceptions; loans given/borrowed and repayment history; staff advances; deposits in transit; daily-close snapshots/differences; and reversals/adjustments/audit history.

Default filters should be understandable: Today, This Month, Custom Range, salesman, type, status, product where relevant, and money account. Searches should accept bill/receipt number, salesman name/code, product alias, payment reference, and legacy paper reference. Paginate rather than loading all history into the browser. Show the active date basis and as-of date on reports and exports.

Use the following reporting definitions consistently:

- Billed sales: posted bill amounts by effective date; no payment amounts included.
- Return credits: posted return-credit amounts by effective date, shown separately.
- Net billed amount: bills less returns and relevant sales corrections; not profit and not cash collections.
- Collections: confirmed/identified salesman receipts; exclude loans, owner funding, transfers, pending claims, and opening entries. Show refunds separately, with any net-collection total explicitly labelled.
- Expenses: classified operating expenses; exclude loan principal, transfers, owner withdrawals, and staff advances until actually settled as expense.
- Receivables: positive signed balances per salesman as of the selected date, not just today's unpaid bills.
- Age of dues: time since effective bill date; distinguish this from overdue days, which require an agreed due date. Show legacy unknown-age dues separately.

Printing must include a readable bill, receipt, salesman statement, and daily-close summary. Build print-ready HTML/CSS first for the browser and an optional backend-generated PDF only if consistently accurate printing requires it; do not assume a specific printer or force a PDF service before testing the real paper format. Use browser print styles with A4 as the starting default; support print-to-PDF through the browser. Do not build a printer-driver integration. Keep narrow paper/thermal formats optional until printer details are known. Repeat table headings and avoid clipped totals on multipage prints.

Printed bills contain confirmed business details, number, issue date, salesman, product lines, quantities, units, rates with price basis, line amounts, bill total, and clearly labelled notes. Print only used product rows. Show previous balance, payment information, pending amounts, and account balance in a separately labelled account-summary section so older dues do not appear to be new sales. Save an issue-time balance snapshot; a reprint must not silently relabel today's account balance as the original balance at issue. A separately generated statement can show current/as-of balances.

Until the statutory document configuration has been approved and implemented, print a clear label such as “Operational record — tax invoice format not configured”; do not infer compliance from a GST identifier or the presence of a bill number.

Receipts identify the payer, receipt number, amount, method, receiving account label, business posting date, actual date when different, reference if appropriate, status, and allocations. A pending claim must be visibly marked Pending / Not Confirmed, never look like a confirmed payment receipt. Reversed documents remain accessible and clearly marked.

Provide UTF-8 CSV exports of displayed reports and a structured full-data export for portability. Export amounts as exact decimal values, include document IDs/links, currency and dates, and protect spreadsheet consumers from formula-injection strings. Do not include secrets, passwords, or access tokens. Offer spreadsheet-compatible output without requiring an additional paid spreadsheet service. A report export is not a substitute for a restorable system backup.

## 16. Financial integrity model

Implement a small internal double-entry journal and explicit operational subledgers. Hide debits/credits from normal manager screens. This is an integrity mechanism, not a claim that the app produces complete statutory financial statements. In unconfigured tax mode, the sales-control account holds agreed operational bill totals; do not label it tax-exclusive accounting revenue.

Suggested internal accounts: each Cash/Bank account; Deposits/Transfers In Transit; Trade Receivables by salesman; Loan Receivables by loan/person; Staff Advances; Unidentified Receipts; Borrowings/Owner Advances Payable; Owner Contributions/Withdrawals; Billed Sales Control; Sales Returns/Credits Control; classified Expenses; Opening Clearing; and tightly controlled Adjustment/Variance accounts.

Illustrative posting map (all amounts are positive on their indicated side):

| Event | Debit | Credit |
|---|---|---|
| Post a bill | Trade receivable for salesman | Billed sales control |
| Confirm cash/bank receipt | Actual cash/bank account | Trade receivable for salesman |
| Post return credit | Sales returns/credits control | Trade receivable for salesman |
| Pay authorized credit refund | Trade receivable for salesman | Actual paying cash/bank account |
| Ordinary paid expense | Appropriate expense category | Actual paying cash/bank account |
| Confirmed internal transfer | Destination account | Source account |
| Deposit handed over, not credited | Deposits in transit | Source physical cash |
| Confirm deposit bank credit | Destination bank | Deposits in transit |
| Give a loan | Loan receivable | Cash/bank |
| Receive principal repayment | Cash/bank | Loan receivable |
| Receive borrowing | Cash/bank | Loan payable |
| Repay borrowed principal | Loan payable | Cash/bank |
| Pay a staff advance | Staff advance receivable | Cash/bank |
| Salary with advance settlement | Full salary expense | Cash/bank net paid plus staff advance settled |
| Receive unidentified bank credit | Bank | Unidentified-receipts holding |
| Identify that existing money to salesman | Unidentified-receipts holding | Trade receivable for salesman |
| Opening debit balance | Relevant asset/receivable | Opening clearing |
| Opening credit/liability balance | Opening clearing | Relevant liability/credit account |
| Reverse a posted event | Exact original credit sides | Exact original debit sides |

Approved owner funding/withdrawals and other special events follow their explicitly selected classification. Do not silently default all inflows to sales and all outflows to expenses. A credit balance on a trade subledger is represented as a salesman advance in operational reports; do not claim a formal balance-sheet classification without the accountant-approved mapping.

Every posted journal entry must balance exactly: sum(debits) = sum(credits). Every line belongs to the same business and has the correct money account/counterparty dimensions. Use database constraints plus posting procedures to enforce this at commit. Never allow ordinary clients to insert arbitrary journal lines directly.

Documents, journal lines, allocations, related approval/audit records, and idempotency response must be created in a single transaction for each financial command. Allocation-only changes must also be atomic and audited. Do not post half a transfer, an invoice without its lines, or a confirmed receipt without its ledger movement.

All displayed balances must be derived from posted journal/subledger records or a transactionally maintained, reconcilable projection. No freely editable `outstanding` or `cash_balance` column can be the independent source of truth. Provide a diagnostic reconciliation that compares journal totals, source documents, allocations, report totals, and any cached projection.

## 17. Fixed implementation architecture — Bun / TypeScript / Turborepo

This section supersedes the former Next.js / Supabase / FastAPI proposals. **Do not scaffold Next.js, FastAPI, SQLAlchemy, Alembic, Supabase, Elysia, or an Android APK by default.** The team has selected a full-TypeScript modular-monolith architecture. Verify current official documentation and compatibility of stable packages before implementation, pin tested versions, and commit `bun.lock`. Avoid unreviewed major-version upgrades during financial feature development.

### 17.1 Agreed technology decisions

| Layer | Selection | Notes |
|---|---|---|
| Repository / builds | **Turborepo + Bun workspaces** | One repository; caching and task orchestration, not a backend framework [R1] |
| Package manager / runtime | **Bun** | Bun installs packages, runs scripts/tests, and executes the API [R2] |
| Frontend | **React + TypeScript + Vite** | Responsive desktop-first SPA; mobile-friendly owner view; optional PWA [R3] |
| UI | **Tailwind CSS + shadcn/ui-style components** | Consistent, accessible, keyboard-friendly design; avoid excessive UI dependencies |
| Frontend data | **TanStack Query** | Server data caching/invalidation; never a second financial source of truth |
| Charts | **Apache ECharts** | Lazy-load on chart/report pages; server aggregates and accessible alternatives [R8] |
| Backend framework | **Hono on Bun** | Versioned JSON API under `/api/v1`; Bun officially supported [R4] |
| Validation / contracts | **Zod** with shared request/response contracts | API must independently validate on the server; optionally derive OpenAPI |
| Database | **PostgreSQL 18** | Private database, exact `NUMERIC`, tested transactional posting [R9] |
| Data access | **Drizzle ORM + tested PostgreSQL `pg` driver** | Pooling/server-only connections; no frontend database access [R5] |
| Migrations | **Drizzle Kit** | Generate/review/commit SQL migrations; deploy only through approved migration workflow [R5] |
| Testing | **Bun test + PostgreSQL integration tests + Playwright** | Unit, integration, concurrency, browser, and print workflows |
| Hosting | **Docker Compose on supported Ubuntu LTS VPS** | Caddy for HTTPS and static React hosting, reverse proxy to API [R6] |
| Optional hosting | **Vercel for the frontend only** | Only if owner approves suitable commercial hosting; public API must still use HTTPS |

The backend is a **Hono application running on Bun**, not "Bun with routes and no framework." Hono's routing and middleware are suitable for a small, single-business API. Do not introduce separate microservices, queues, Kafka, Redis, or Kubernetes without a demonstrated operational requirement.

### 17.2 Repository layout and import boundaries

```text
family-sales-ledger/
├── AGENTS.md                    # small Codex instruction entry point
├── CODEX_APP_CONTEXT.md         # full business + technical specification
├── ASSUMPTIONS.md               # recorded deviations and unresolved choices
├── README.md
├── bun.lock                     # committed lockfile
├── package.json                 # Bun workspace + Turborepo scripts
├── turbo.json
├── tsconfig.base.json           # strict TypeScript defaults
├── apps/
│   ├── web/                     # React + Vite + TS + UI + TanStack Query + ECharts
│   └── api/                     # Hono + Bun + auth + routes + domain services
├── packages/
│   ├── contracts/               # Zod schemas and public API TypeScript types
│   └── db/                      # Drizzle schema, reviewed migrations, server-only
├── infra/
│   ├── compose.yaml
│   ├── Caddyfile
│   └── Dockerfiles/
├── docs/                        # ledger map, permissions, runbooks, manager guide
└── tests/                       # database-backed integration / Playwright E2E
```

`apps/web` may import **only** browser-safe exports from `packages/contracts`; it must never import `packages/db`, server service code, database secrets, or privileged role implementations. The API alone owns database access, authentication, permissions, financial commands, and authoritative calculations. Share *schemas/types*, not unverified client-side balance logic. Use strict TypeScript. Do not make frontend runtime validation optional merely because both sides share static types.

### 17.3 API contracts and authentication

- Serve versioned endpoints such as `POST /api/v1/bills`, `POST /api/v1/receipts`, `POST /api/v1/receipts/{id}/verify`, `POST /api/v1/transfers`, `POST /api/v1/daily-closes`, and read-only statement/report routes. Exact names may differ, but document and test one consistent API. Avoid a generic unrestricted journal-writing endpoint.
- Define canonical request/response Zod schemas in `packages/contracts`. Use opaque IDs and stable error codes. Return decimal money as **strings**, e.g. `{ "amount": "4000.00", "remainingDue": "6000.00" }`; never use browser-supplied totals as authority. Add idempotency keys to financial posting commands.
- Use a maintained, Bun/Hono-compatible authentication/session solution (verify compatibility before adopting it; do not write password cryptography). For browsers prefer Secure + HttpOnly + SameSite cookies, protected from CSRF where needed, with server-side role checks on **every** protected API path. Disable public registration; allow safe owner provisioning, credential reset, logout, session revocation and optional MFA.
- The browser calls relative `/api/v1/...` under the same HTTPS origin by default. Do not expose privileged API or database secrets through `VITE_*` environment variables. Avoid placing tokens or personal financial data in URLs.
- Separate authentication, permission checks, input validation, business rules, and database posting services. Owners and managers must have different capabilities as specified in §4; do not trust a role from the client.

### 17.4 Exact money and financial transactions

- Database posted money amounts: PostgreSQL `NUMERIC(18,2)` or a documented equivalent. Store rates, price bases, quantities, and conversion factors at higher justified precision and use the specified rounding boundaries. Store UTC timestamps and explicit `DATE` business dates; display in Asia/Kolkata.
- In TypeScript use an established decimal-arithmetic library (for example `decimal.js`) or a rigorously audited integer-minor-unit design. **Do not calculate money with JavaScript `number`, `parseFloat`, implicit floating-point arithmetic, or JSON-number amounts** in authoritative posting, reconciliation, discount, or allocation logic.
- Implement **one real Drizzle/PostgreSQL transaction per financial command**, including journal lines, source document, allocations, audit events, and idempotency record. Verify transaction support with the actual chosen driver and Bun version. Use locks/unique constraints and safe serialization or retry on recognized concurrency errors; do not assume atomicity from multiple separate API calls.
- Use immutable posted documents and reversal entries rather than editing/delete history. Treat all money and subledger report totals as derived from posted records or transactionally maintained projections. Apply the financial invariants in §§16, 18, and 19 without relaxation.
- Drizzle schema files are not a production migration by themselves. Create SQL migrations with Drizzle Kit; inspect/review every generated migration, test it on a copy of realistic data, ensure it is backwards-safe where possible, back up production, and seek authorization before running a live migration. Do not use uncontrolled schema push on production.

### 17.5 Frontend and dashboard boundaries

- Desktop manager interface optimized for 1366×768, rapid keyboard bill entry, searchable salesmen/products, minimal typing, explicit save/confirm status, and safe retries. Mobile layout optimized for the owner's summary and transaction drill-down. Optional installable **PWA**, not a native APK.
- Use TanStack Query for server reads/caching and explicit invalidation after successful mutations. Cached dashboard values must display their refresh status and never masquerade as verified live bank balances. Optimistic updates must never present uncommitted financial postings as final.
- ECharts is **presentation only**. Its figures must come from the same server aggregation endpoints and filters used by the corresponding statement/reports. First ship accurate numeric cards and reports; then add charts without adding new independent accounting calculations. Provide text summaries and table equivalents for accessibility.
- Printing should initially use React/browser print views with shared read-only server-issued document data; server-generated PDFs may be added later if actual printer testing reveals a concrete need.

### 17.6 Development, tests, and release commands

Give the root workspace scripts stable names (`dev`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `db:migrate`, `db:seed:demo`) and document their exact Bun/Turbo commands in README. Use Bun for package installation and scripts; coordinate jobs with Turborepo. Ensure `typecheck`, `lint`, `test`, and `build` run in CI. Use `bun test` where appropriate; use Playwright for real browser journeys.

Automated database integration tests **must use PostgreSQL**, not an in-memory SQLite substitute. Include double-submit, concurrent credit allocation, same-day close/post race, rollback, ledger balance, role bypass, and restore-drill tests. Run at least representative checks on the chosen Bun runtime, in Docker where applicable. A successful TypeScript build is not proof of financial correctness.

### 17.7 Local and production deployment

- Local: Docker Compose provides PostgreSQL 18 and any needed development API services; run web and API with reproducible Bun scripts or containers. Never treat browser localStorage or fixture arrays as the production data layer. Demo data belongs only in a clearly separated development/test environment.
- Production: supported Ubuntu LTS VPS with Docker Compose; separate **Caddy** public entrypoint, Bun/Hono API container, private PostgreSQL container with persistent volume, static React build, and private file/attachment storage. Only HTTPS 443 (and necessary HTTP 80 for redirects/certificates) should be publicly accessible. **Never publish PostgreSQL port 5432.**
- Same-origin routing: `https://your-domain.example/` serves React; `https://your-domain.example/api/v1/*` proxies internally to Hono. If Vercel hosts the web build, proxy to an **HTTPS-protected** VPS API or use explicitly approved HTTPS cross-origin API access; Vercel routing alone is not transport security. Verify PWA and auth cookies under the actual domains.
- Keep secrets in secure environment configuration, not Git. Provide safe `.env.example` with placeholders, `.dockerignore`, `.gitignore`, health checks, restart policy, log/volume limits, production deployment runbook, and explicit update/rollback procedures. Do not claim 24/7 reliability merely because Docker starts.
- Back up PostgreSQL, private attachments, and critical configuration **off the VPS**; use encryption and a documented restore process. Decide recovery point/time objectives with owner, verify actual backup success, and perform periodic isolated restore drills. A CSV export is not a usable substitute for a database restore [R10].

**Choosing the development model:** Codex model/effort selection happens in Codex settings. Follow the owner's GPT-6.1 Sol Medium preference if available; do not build functionality dependent on that exact model label or claim to have controlled it from this file. No automatic public deployment, purchases, credential access, or destructive production action without permission.

## 18. Logical data model and constraints

The following is a logical model, not an instruction to create a separate table for every phrase. Consolidating equivalent concepts is acceptable if all semantics, constraints, and history remain intact.

| Entity | Minimum important fields/relationships |
|---|---|
| Organization/settings | ID, display details, currency, timezone, business setup state, numbering/rounding/payment policies |
| User/membership | Auth user ID, organization ID, role/capabilities, active state; no client-controlled role escalation |
| Salesman | Organization ID, unique code, name, contact/notes, active flag, optional terms/limit |
| Staff/counterparty | Organization ID, name, optional linked salesman, independent purpose/type |
| Product/configuration | Code, name/alias, active flag, base/selling units, conversion, price basis, fractional policy, effective version, confirmation state |
| Price version | Product/configuration ID, effective date, rate, actor; historical versions retained |
| Money account | Organization ID, name, type, custody/holder, masked details, active state, overdraft policy if enabled |
| Invoice and line | Number, salesman, status, effective/recorded dates, line snapshots, totals, issue-time account snapshot, note, legacy reference |
| Payment/receipt | Payer, amount, method/account, claim/verification/posted state and dates, bank-credit identity when relevant, actor, attachments |
| Bank receipt group | One actual bank credit identity/amount/account, identification state, child assignments; prevent double posting |
| Charge/credit items | Source documents, salesman, original amount, effective date, eligible settlement capacity |
| Allocation / credit use | Credit source, debit item or refund use, amount, effective date, actor, reversal/reallocation history |
| Return and line | Original invoice/line, units/quantity, original price snapshot, eligible value, reason, posted state |
| Refund | Salesman, consumed credits, amount, actual paying account, approval/state, references |
| Expense and payment legs | Category, payee, period if salary, amount, accounts, date, attachments, any staff-advance settlement |
| Loan and movements | Direction, counterparty, principal, due date if any, disbursement/repayment sources, interest component separately |
| Transfer/deposit | Source, destination, amount, initiation/credit dates, pending/confirmed/returned state, deposit reference |
| Opening batch/items | Cutover date, signed balances, optional legacy bills, preparer/approver, imported row IDs, finalization state |
| Journal entry and lines | Organization/source-event ID, effective date, recorded/posted timestamps, immutable amounts/dimensions, reversal link |
| Daily close and versions | Account/custodian, date, expected/count/difference, notes, status, closer/approver, reopening/replacement links |
| Bank reconciliation | Account, statement date/balance, book snapshot, matched items, difference, version/status |
| Approval/correction request | Requested action, frozen payload/version, requester, approver, reason, state; no financial effect by itself |
| Attachment | Private object key, organization/source link, file type/size/hash, uploader, metadata; no public URL |
| Audit event | Actor, action, target, server timestamp, reason, safe before/after or linked event, request/correlation ID |
| Idempotency record | Organization, command type, client key, payload hash, completion state/result, created timestamp |

For every mutable draft, use a version/concurrency token so one browser tab does not silently overwrite another. Posted financial documents use immutable source data plus reversals, not ordinary edits. Nonfinancial corrections to labels/notes must still be audited and must not change historical snapshots.

Use database foreign keys, positive-amount checks, uniqueness for issued numbers and bank-credit identities, and constraints preventing cross-organization references. Include organization_id even though version 1 is one business; this helps enforce scope without building multi-tenant SaaS features. Explicitly reject invalid/dangling IDs and unauthorized cross-record access.

No cascade deletion of financial history when a product, user, account, or salesman is deactivated. Retain attribution for inactive users. Disallow deleting/renaming stable identifiers in a way that changes historical meaning.

Assign bill/receipt/return/transfer numbers on the server using a transaction-safe sequence/allocator. Do not use `count + 1` or browser-generated “next number.” Keep a configurable prefix and starting sequence; do not assume continuity with the paper book. Keep legacy paper references separate. Numbers must be unique and never reused after posting/reversal. Sequence gaps caused by rollback are acceptable and must not be disguised.

## 19. Command behavior, concurrency, and failure handling

Implement reviewed server commands such as PostBillWithReceipts, ConfirmReceipt, RejectReceiptClaim, IdentifyBankReceipt, PostReturn, IssueRefund, PostExpense, PostLoanMovement, InitiateDeposit, ConfirmDeposit, PostTransfer, FinalizeOpeningBatch, CloseCashDay, ReverseDocument, and ReopenDay. An equivalent naming scheme is fine.

Approval records must bind to the exact action, amounts, account IDs, business date, and draft version. Changing the payload invalidates the approval, and retrying an approved command must not execute it twice.

Every financial command must authenticate and authorize the actor; validate organization/counterparty/account relationships; validate effective date and lock state; load authoritative prices/balances; recompute amounts server-side; enforce limits and quantities; acquire necessary locks; post all financial effects atomically; write audit events; and return canonical saved IDs/numbers/balances. Never trust a browser-supplied calculated total, role, confirmation flag, or “remaining amount.”

Use a unique client-generated idempotency key per attempted financial action. The same key with the same canonical payload returns the same result without a second posting. The same key with a different payload must produce a clear conflict, not silently reuse the old result. Preserve the key through a timeout/retry; only a deliberately new transaction gets a new key. Keep a uniqueness record tied to the lasting financial document even if cached response data expires.

Lock or serialize operations affecting the same salesman credit capacity, invoice allocation, returnable quantity, loan balance, refund capacity, cash account balance, or day-close boundary. Recheck after acquiring locks. A concurrent close and receipt cannot leave a hidden late posting in a frozen day. Two refunds cannot both consume the same available credit. Two returns cannot exceed the original sold quantity.

A database rollback must leave no partial posting. A successful commit followed by a lost response must be recoverable by idempotent lookup. Failed file upload or printing must not lead the user to enter a duplicate transaction; show that the money record is saved and which secondary action failed.

If internet is unavailable, show “Not saved to business records.” The first version must not offer unsupervised offline financial posting or an ambiguous auto-sync queue. Non-sensitive temporary draft recovery may be supported, clearly marked, scoped to the user/device, and cleared on logout where appropriate. Local browser storage is never the official ledger or backup.

Return actionable field errors, not stack traces. Preserve draft input. On conflict, refresh the affected balances and ask the user to review the changed result instead of forcing an outdated submission through.

## 20. Security, privacy, attachments, and operations

Disable public self-registration. Provision the first owner through a secure setup process. Support invite/reset/revocation, individual logins, reasonable session expiry, and owner multifactor authentication when supported. Revoked/inactive users must immediately lose access. Never publish real credentials or leave a known demo password on a public deployment.

Check permissions for page data, Hono API endpoints, database commands, report exports, print pages, and attachments. The Bun API is the only service with PostgreSQL credentials; React must never connect directly to PostgreSQL. Keep signing keys, database URLs and privileged secrets server-only. Even behind authentication, every posting endpoint must enforce the actor's role/capabilities and the target business/account relationship; do not trust a role supplied by the client.

For cookie-based browser sessions, use Secure, HttpOnly, SameSite cookies; implement CSRF protection appropriate to the selected session mechanism, plus safe CORS/origin validation and rate limiting [R12]. Explicitly test authentication persistence and revocation across web reloads and proxy boundaries. Protect against request forgery where applicable, input/script injection, brute-force authentication attempts, and leaked secrets. Avoid sensitive financial details in browser analytics, diagnostic logs, error tracking, and URLs. Use encrypted transport in deployment. Limit logs to necessary diagnostic information with access controls.

Use private attachment storage, authenticated access or short-lived signed access, content-type/signature validation, reasonable size limits (proposed 10 MB per file), randomized keys, and no executable HTML/SVG content. Accept only needed image/PDF evidence formats. Do not run OCR or send customer financial files to an external AI service by default. Scan uploads when a supported scanning service is configured; do not claim scanning exists when it does not.

Audit logs include posting, confirmation, rejection, reversal, adjustments, opening approval, price/permission changes, day reopen, imports, and sensitive exports. “Immutable in the app” does not mean a privileged database administrator is physically incapable of modifying data; do not claim tamper-proof security without additional infrastructure. Limit infrastructure access and keep independent backups.

Back up the PostgreSQL database, private attachments, and necessary configuration/restore instructions separately and test restoration into an isolated environment. A copy of the Docker volume on the same VPS is not an off-server backup. Use suitable PostgreSQL backup mechanisms and verify consistency; protect encryption keys and ensure the restoration procedure covers attachments and application secrets without exposing them [R10]. Do not show a green “backup working” badge based only on a planned feature or a successful CSV export.

Proposed deployment requirement: automated daily backups at minimum, plus a documented owner-approved recovery-point/recovery-time target and consideration of more frequent recovery for live financial records. Show the latest actual successful backup/check status only when it is truly available; otherwise say the status is not connected. Conduct and record a restore test before live use and periodically thereafter. The restore test must verify balances, attachments, permissions, and audit history, not just that a database file exists.

Use business-controlled hosting/provider accounts, documented ownership, dependency/migration maintenance instructions, and a way to export all business records. No destructive “reset demo” button can touch the live organization. Never execute migrations against production without a backup and an approved change plan.

## 21. Demo data and acceptance tests

Seed a separate, clearly labelled demo business with an owner, manager, 12 fictional salesman records, a few fictional products with unambiguous units, main cash, one or two bank accounts, and representative transactions. Do not reuse names, payment references, bank details, or handwriting-derived amounts from the photograph as real starting data. Test credentials must be confined to local/test configuration.

Automate the money/permission/concurrency cases below. Browser tests should cover representative end-to-end journeys. Use exact decimal assertions. Cases are independent unless their descriptions explicitly continue the preceding case.

| ID | Scenario and required result |
|---|---|
| A01 | Opening salesman due ₹5,000 creates due ₹5,000, zero new sales, zero cash collections. |
| A02 | Continuing A01: bill ₹20,000, confirmed cash ₹8,000, online claim ₹7,000 pending. Due = ₹17,000; cash +₹8,000; bank unchanged; pending = ₹7,000. |
| A03 | Continuing A02: verify the ₹7,000 exactly once. Due = ₹10,000; bank +₹7,000; cash unchanged. Verification retry changes nothing. |
| A04 | Continuing A03: receive another confirmed ₹4,000 later. Due = ₹6,000. A linked ₹1,000 return then makes due ₹5,000 without another money movement. |
| A05 | A rejected/unverified claim never reduces due or increases cash/bank/collections. Confirmed receipts cannot be retroactively rejected; use reversal. |
| A06 | Salesman owes ₹1,000 and pays ₹1,500: due ₹0, available credit ₹500. A later ₹800 bill consumes that credit and leaves ₹300 due, without a second receipt. |
| A07 | An opening advance ₹500 applied to a new ₹800 bill leaves ₹300 due, but neither opening nor allocation creates new cash collections. |
| A08 | Bills ₹1,000 and ₹2,000, then receipt ₹1,500: oldest bill settled, second bill ₹1,500 remaining. Reallocation changes neither total due nor money balances. |
| A09 | Fully paid bill ₹1,000, return ₹200: release/reallocate earlier payment correctly, available credit ₹200, no cash payout. Refund ₹200 then leaves zero credit and reduces paying account by ₹200. |
| A10 | Refund ₹300 against only ₹200 available credit is blocked. Concurrent refunds of ₹150 each cannot both consume that ₹200. |
| A11 | Sold quantity 5, prior effective return 2: return of 4 is blocked. Reversal of a return restores its returnable quantity exactly once. |
| A12 | Product price changes from ₹100 to ₹120: old bill and return use the original snapshot. New bills use the new effective price. |
| A13 | Fictional 2 boxes × 10 units, rate ₹250 per 100 units = ₹50.00. Unconfirmed “M”/conversion configuration blocks live posting but not unrelated configured products. |
| A14 | One line: 3 × ₹10.005 rounds half-up to ₹30.02. Three separate one-unit lines round to ₹10.01 each, totaling ₹30.03. Show the chosen line-rounding rule consistently. |
| A15 | Fractional quantity on an integer-only product is rejected. Changing master unit conversion never rewrites historical quantities/amounts. |
| A16 | Physical opening ₹5,000 + cash receipts ₹8,000 − diesel ₹600 − bank deposit handed over ₹10,000 = expected physical cash ₹2,400. Online ₹7,000 does not change that cash figure. |
| A17 | Deposit initiated for ₹10,000: cash −₹10,000, transit +₹10,000, bank unchanged. Confirmation: bank +₹10,000, transit zero; sales/receipts do not increase. Retry does not post twice. |
| A18 | A ₹10,000 deposit partially credited ₹8,000 leaves ₹2,000 in transit; returning that ₹2,000 to cash clears transit. Repeated confirmations/returns cannot exceed the original deposit or move it twice. |
| A19 | Confirmed business-account transfer ₹2,000 changes only source/destination; total business money and sales are unchanged. Same-account transfer is rejected. |
| A20 | Loan given ₹2,000, principal repaid ₹500: loan receivable ₹1,500; no sales or operating expense from principal. |
| A21 | Borrow ₹10,000, repay principal ₹3,000: liability ₹7,000; no new sales or principal expense. Excess principal repayment is rejected. |
| A22 | Staff advance ₹2,000 then salary ₹5,000 with setoff: salary expense ₹5,000, later actual payout ₹3,000, staff advance zero; the initial advance is not an extra expense. |
| A23 | Owner injects ₹10,000 as declared funding: cash/bank increases, sales remain unchanged. Owner-held business cash transfer and personal withdrawal have distinct classifications. |
| A24 | Salesman A owes ₹5,000 and B has ₹2,000 credit: headline receivables ₹5,000 and advances ₹2,000 separately, not “outstanding ₹3,000.” |
| A25 | Actual counted cash ₹2,350 versus expected ₹2,400 creates difference −₹50, reason/exception, and no hidden ₹50 expense or opening reset. |
| A26 | Close day, then attempt manager backdated posting: blocked. Owner reopening retains earlier snapshot and invalidates/recomputes affected later closes. |
| A27 | Online payment claimed on a closed yesterday, verified today: current open-date posting by default; actual claimed date preserved; yesterday's close not silently changed. |
| A28 | Double-click/retry Post Bill, Confirm Receipt, or Transfer with same idempotency key yields one posted event. Same key with different payload yields conflict. |
| A29 | Simulate failure midway through a posting: no partial document/journal/transfer effects survive. Simulate lost response after commit: retry returns existing result. |
| A30 | Concurrent allocations cannot overapply a receipt or over-settle a bill. Concurrent returns cannot exceed quantity sold. |
| A31 | Concurrent day close and posting resolve in a controlled order: no unlisted transaction appears in a frozen close. |
| A32 | Manager attempts owner-only correction/permission change through direct API: denied. Hiding buttons alone is not sufficient. |
| A33 | An unauthorized or optional salesman user cannot read another person's records, statements, exports, or attachment URLs by changing IDs. |
| A34 | Reversing a paid ₹1,000 bill leaves its genuine ₹1,000 receipt as usable credit or applied to other dues; no automatic cash refund. |
| A35 | Reversing a confirmed receipt reverses actual money and due effects once and reopens/reallocates settlements consistently. Original receipt remains visible. |
| A36 | Bank credit ₹700 initially unidentified: bank +₹700, holding +₹700, salesman due unchanged. Identifying it to a salesman reduces due ₹700 without bank +₹700 again. |
| A37 | A single ₹1,000 bank credit split ₹600/₹400 across two salesmen credits the bank only ₹1,000 and reduces the respective dues once; assigned total above ₹1,000 is rejected. |
| A38 | Identical amounts from different legitimate bank transactions remain possible. Reusing the same receiving-account bank credit identity for another financial posting is blocked. |
| A39 | Opening import repeated with the same batch/row IDs does not double balances. Importing total legacy due plus the same old invoices is detected/prevented. |
| A40 | Statement for a selected range has correct brought-forward balance and ties to account balance at the same as-of date. Unknown legacy age is not invented. |
| A41 | Posted document numbers stay unique under concurrency; reversed numbers are not reused; old paper references are searchable but do not dictate the new sequence. |
| A42 | CSV/print totals tie to on-screen totals; original issue-time balances are not silently replaced on reprints; pending claims cannot print as confirmed receipts. |
| A43 | Invoice and payment on the same screen produce separate, correctly linked postings; a pending online child creates no journal movement. |
| A44 | A ₹1,000 expense split ₹300 cash / ₹700 bank reduces those accounts by exactly those amounts and records only ₹1,000 expense. |
| A45 | Credit limit ₹1,000; existing due ₹900; new bill ₹500 and confirmed payment ₹400: projected due ₹1,000 allowed. If ₹400 is only pending, projected ₹1,400 needs override. |
| A46 | Posted amounts, cashier cash, receipt status and permissions cannot be manipulated by altering client-submitted calculated fields. Server recomputes and rejects invalid inputs. |
| A47 | Product/salesman/user deactivation preserves history. Inactive salesman cannot receive new bills, but old dues can still be collected. |
| A48 | Network offline/timeout never shows false “Saved.” Failed print/upload after a committed receipt clearly distinguishes the saved receipt from the secondary failure. |
| A49 | Every financial posting and reversal balances debits and credits; journal, source records, salesman balances, allocations and money-account reports reconcile. |
| A50 | Backup restore into an isolated environment restores financial records, private attachments, permissions and audit history; credentials are not leaked or copied into public demo data. |
| A51 | Full return of a line whose partial returns involved rounding exactly credits its eligible original amount, not a paise more/less. Refunds and return reversals maintain credit-source conservation. |
| A52 | Date boundary around midnight in Asia/Kolkata selects the intended business date even when server timezone is UTC; future-date and closed-date controls hold. |
| A53 | Multiple account holders' cash books reconcile independently; manager-to-owner business-cash handover is not double-counted as an expense, receipt, or withdrawal. |
| A54 | Reference attachments stay private after logout and account revocation; exports exclude secrets and neutralize spreadsheet formula-injection content. |
| A55 | Restore/migration/demo-reset operations cannot target live data accidentally; destructive operations require an explicit, separately authorized operational procedure. |

Implement the acceptance scenarios primarily as **Bun test unit tests** for pure calculations, **PostgreSQL-backed API/integration and concurrency tests** for postings/authorization, and **Playwright browser tests** for real manager/owner workflows. Use a separate test database with deterministic seed and never run a destructive reset against production. Include a test demonstrating `4000.00` stays a decimal string through the API and never becomes an imprecise JavaScript float.

Also perform browser usability tests with keyboard-only billing, validation failures, empty data, large text, phone owner dashboard, and printing across multiple pages. Test performance with representative history (for example, 10,000 demo bills and 100,000 lines) and report measured results rather than claiming unmeasured speed. Avoid making all financial queries download the entire database to the client.

## 22. Delivery stages and required handover

Implement in the following order, keeping the application runnable and tested after each stage:

1. Create Bun/Turborepo monorepo, React/Vite web and Bun/Hono API, shared Zod contracts, Drizzle/PostgreSQL 18 migrations, authentication, roles, business/money-account setup, demo separation, and product/salesman masters.
2. Exact-money domain functions, internal posting engine, opening entries, idempotency, allocation rules, date locks, and automated integrity tests.
3. End-to-end bill entry, cash/online receipts, verification, advances, statements, returns, and refunds using that engine.
4. Expenses, salary/staff advances, loans, borrowing, owner money, transfers/deposits, bank reconciliation, and daily close.
5. React owner/manager home screens, responsive reporting and ECharts visualizations (after numeric reports are correct), search, printing, export, audit visibility, private attachments, and error/retry flows.
6. Permission/concurrency/browser tests, restore drill, deployment documentation, and final acceptance review.

Do not silently declare omitted stages complete. Work through the stages within the authorized development environment rather than pausing after every design choice. Ask only when an external credential, paid action, destructive operation, or truly unresolvable business decision is necessary. Preserve existing code and data; inspect a repository before overwriting files.

Required handover files/artifacts: source code; **`AGENTS.md` pointing to `CODEX_APP_CONTEXT.md`**; root Bun/Turbo configuration and lockfile; React/Vite web and Hono/Bun API; reviewed Drizzle migration SQL; demo seed; Bun/PostgreSQL/Playwright tests and actual results; README with exact setup, dev/test/build/deploy commands; `.env.example` without secrets; `ASSUMPTIONS.md`; data model and posting map; permissions matrix; requirements/test checklist; backup-and-restore runbook; production Docker Compose/Caddy configuration; and a plain-language manager guide covering bill, partial payment, online verification, return, expense, deposit, and daily close.

At completion, explain which workflows are implemented and tested, which tests actually ran, which were blocked, any remaining defects, required live settings, and operating/hosting dependencies. Do not fabricate screenshots, test outcomes, bank integration, tax compliance, backup status, or production-readiness.

## 23. Before using real business money records

The owner/manager must verify real salesman identities and opening balances, product units and prices, receiving accounts, role policies, print outputs, and the daily-close flow. Tax/statutory document needs must be reviewed separately before replacing the existing official invoicing process. Keep operational ledger mode visibly distinct from statutory invoicing when not configured.

Use a controlled parallel trial with the existing records and reconcile bills, receipts, bank movements, and closing cash. Confirm a successful restore drill and access revocation test. Obtain a competent developer's review of the financial posting/permissions implementation and the accountant's review of relevant bookkeeping/tax mappings. A generated app is not proven correct merely because it runs.

Do not migrate live balances based on handwriting guesses or unapproved import data. Do not clear the old records before the new system is reconciled and independently backed up.

## 24. Technical references for Codex

Business rules in this specification come from the owner's workflow description and agreed design decisions. Technical references support implementation choices, not claims that the app already exists. Recheck compatibility, current API signatures, security advisories, and version support before installing packages.

[R1] Turborepo documentation — monorepo workspaces and task orchestration: `https://turborepo.com/docs`

[R2] Bun documentation — runtime, package management, TypeScript, Bun test and workspaces: `https://bun.com/docs`

[R3] Vite documentation — React/TypeScript frontend builds: `https://vite.dev/guide/`

[R4] Hono documentation — official Bun deployment example and middleware: `https://hono.dev/docs/getting-started/bun`

[R5] Drizzle documentation — PostgreSQL setup and migrations: `https://orm.drizzle.team/docs/get-started-postgresql` and `https://orm.drizzle.team/docs/migrations`

[R6] Caddy documentation — HTTPS and reverse proxy: `https://caddyserver.com/docs/automatic-https` and `https://caddyserver.com/docs/quick-starts/reverse-proxy`

[R7] Docker Compose production guidance: `https://docs.docker.com/compose/how-tos/production/`

[R8] Apache ECharts documentation: `https://echarts.apache.org/en/index.html`

[R9] PostgreSQL 18 documentation — exact numeric types and transactions: `https://www.postgresql.org/docs/18/datatype-numeric.html` and `https://www.postgresql.org/docs/18/tutorial-transactions.html`

[R10] PostgreSQL backup methods and recovery: `https://www.postgresql.org/docs/18/backup.html`

[R11] OpenAI Codex documentation — project instructions (`AGENTS.md`), file discovery and instruction budget: `https://learn.chatgpt.com/docs/agent-configuration/agents-md`

[R12] OWASP session management guidance: `https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`

---

## One-sentence product definition

A simple, desktop-friendly business diary in which the manager records bills and money movements once, each salesman personally owes his own purchases, balances are calculated from an auditable ledger, and the owner can see what is owed, where the money is, and whether the day reconciles.
