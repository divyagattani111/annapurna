# Server permissions

Bill-only rate/basis edits and discounts have independent owner-controlled manager capabilities: `editBillPrices` and `applyBillDiscounts`, default absent/disabled. Managers may prepare edited previews and frozen approval requests. Posting with explicit edits requires the respective capability or owner status; checks precede cached retries too. These grants do not authorize changing product masters, historical bills, units/conversions, credit limits or arbitrary ledger amounts.

| Capability | Owner | Manager |
|---|---|---|
| Operational reads, statements, filtered exports | Yes | Yes, within same business |
| Post bills, cash receipts, expenses, salaries, transfers/deposits, returns | Yes | Current open date only |
| Verify/reject pending online payments | Yes | Yes by default; owner can revoke |
| Loans, staff advances, principal repayments, owner money, refunds | Post | Frozen request only; no financial effect until owner approval |
| Opening finalization, corrections, reversals, reopening | Post with appropriate reason | Request only |
| Product units/rates, accounts, credit limits, permissions, users | Yes | No |
| Create salesman without opening balance/limit authority | Yes | Yes |
| Full audit, full portability export, setup approval | Yes | No |
| Delete/overwrite posted financial history | No application capability | No |

Authorization runs on Hono routes and again inside financial transactions. IDs are organization-scoped through reads, exports, commands and attachments. Client-submitted role/calculated totals are rejected or ignored in favor of authoritative membership/pricing. A manager cannot self-promote. Revocation immediately blocks every protected request; sessions are also deleted. Password reset uses Better Auth's maintained hash implementation and revokes existing sessions.

Authentication is Better Auth email/password plus PostgreSQL sessions. Public registration/recovery endpoints are not mounted. First owner provisioning is a private server operation. Subsequent manager credentials are created by an authenticated owner. Browser cookies are HttpOnly/SameSite and Secure in deployment; no browser token storage. Business mutations require the exact allowed Origin. Better Auth additionally enforces its authentication origin/CSRF/rate-limit rules.

Caddy is the only public service in deployment; it must replace the trusted client-IP header rather than accepting arbitrary browser values. Keep the API unreachable directly. Development is loopback-only. Confirm cookie persistence, logout and revocation through the actual deployment proxy before live use. MFA is not configured; do not claim it is enabled.
