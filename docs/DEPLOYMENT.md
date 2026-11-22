# VPS deployment and updates

No production deployment has been run. This runbook is for a separately authorized operator after the live prerequisites and independent review. Use a business-controlled Ubuntu LTS VPS/domain and approved costs. Vercel has not been selected.

## Architecture and prerequisites

Caddy publishes only 80/443; it serves the static React build and proxies `/api/*` to Hono. API and PostgreSQL share an internal Docker network. PostgreSQL has no host port. Persistent volumes hold PostgreSQL 18 data, private evidence and Caddy certificate state. API runs as Bun's unprivileged user. Evidence is not served by Caddy. The database role must be limited to this database and infrastructure access restricted.

Images are version-pinned: Bun 1.4.4, PostgreSQL 18.6, Caddy 2.11.9. The PostgreSQL 18 volume is mounted at `/var/lib/postgresql` (version-specific data directory inside). Record resolved image digests for each actual approved release. Do not change a PostgreSQL major image tag over an existing volume.

Prepare a private `.env.production` with a migration/admin `POSTGRES_PASSWORD`, a separate `APP_DB_PASSWORD`, `DOMAIN`, `BETTER_AUTH_SECRET` (32+ high-entropy characters), and `BACKUP_HOST_DIR` if using the operations overlay. URL-encode any database password used inside `DATABASE_URL`; choose a generated URL-safe value to avoid URL ambiguity. Do not put real secrets into examples, images or Git. Keep private files 0600 and app-owned directories 0700. The Compose environment sets `APP_MODE=live`, Secure cookies and the actual HTTPS origin.

Caddy overwrites `X-Ledger-Client-IP` and the API trusts that dedicated header only in the private proxy deployment. Do not expose the API port or accept a user-controlled forwarded client-IP header. Validate actual client-IP resolution/rate limiting after deployment.

## Approved first installation

After approval, from the installed repository:

```sh
docker compose --env-file .env.production -f infra/compose.yaml config --quiet
docker compose --env-file .env.production -f infra/compose.yaml build
docker compose --env-file .env.production -f infra/compose.yaml up -d --wait db
```

Take the prescribed backup/change-plan step before any migration on a database with records. A fresh installation still requires explicit operator authorization to run live migrations:

```sh
docker compose --env-file .env.production -f infra/compose.yaml --profile operations run --rm -e APPROVED_MIGRATION=yes migrate
```

The fresh database init script creates non-superuser `ledger_app`. Apply the explicit runtime grants after migrations:

```sh
docker compose --env-file .env.production -f infra/compose.yaml exec -T db psql -U ledger_admin -d family_ledger_live -v ON_ERROR_STOP=1 -f /opt/ledger/grant-runtime.sql
```

The always-running API uses only `ledger_app`; it cannot own schema, update/delete financial history, change organization mode or run migrations. The temporary migration/backup service uses the separately protected administrator credential. Init scripts only run on a new volume; an existing database needs a reviewed role-creation/grant procedure, not a volume reset.

Provision the first owner once. Supply `OWNER_EMAIL`, `OWNER_PASSWORD`, confirmed `BUSINESS_NAME` privately through a 0600 environment file, not pasted into terminal history. A separate live provisioning procedure must be authorized; the script refuses an already-populated organization database.

Create an ignored private `.local/owner.compose.yaml` override:

```yaml
services:
  api:
    env_file:
      - ../.env.owner
```

```sh
docker compose --env-file .env.production -f infra/compose.yaml -f .local/owner.compose.yaml run --rm -e APPROVED_PROVISION=yes api bun --no-env-file scripts/provision-owner.ts
```

Remove the temporary owner-password file securely after confirming access. Do not seed demo data into this database.

```sh
docker compose --env-file .env.production -f infra/compose.yaml up -d --wait api caddy
```

Do not run these commands from this development session against a real server. Opening a public website requires separate authorization and an approved domain/provider. No port other than 80/443 and tightly restricted administrative access should be publicly reachable.

## Live-use gates

In Settings, configure business details, cash custody/bank accounts, products with explicitly confirmed units/conversions/rates, individual manager access, cutover and approved openings. Review print output, statutory needs, a reconciled parallel trial, private attachment access, backup restoration and independent developer/accountant review. The owner must complete and save every readiness attestation, then explicitly approve live setup. Demo/test organizations cannot be converted to live. Changing the business setup clears live approval.

A checkbox is an owner attestation, not automated evidence of compliance. Do not approve it without performing the corresponding review. Tax/statutory invoicing remains visibly unconfigured. The operational ledger must not replace the official invoice process until the accountant has reviewed that separately.

## Deployment verification

- HTTPS certificate valid for approved domain; no mixed HTTP API calls.
- Login persists after reload through Caddy; Secure/HttpOnly/SameSite cookies; cross-origin mutations denied.
- Logout and owner revocation immediately deny API, exports, print data and attachments.
- Database/API ports unreachable from the public network; evidence paths never publicly served.
- Open a fictional isolated staging business to trial bill, cash/online verification, return/refund, expense, partial deposit and close/reopen.
- Reconcile actual trial balances with existing records and verify the isolated restore runbook.
- Inspect logs/retention/disk use and ensure no secrets/financial payloads are logged.

Real-domain TLS, the user's physical printer, live opening data and external backup destination were not configured during this build.

## Updates and rollback

1. Review source/lockfile/migration diff and run typecheck, lint, Bun/PostgreSQL and browser tests in staging.
2. Record release image digests, current version and approved migration plan. Create and verify a private off-server backup.
3. Pause financial entry during the maintenance window; do not hide posting failures behind optimistic success.
4. Apply reviewed additive migrations with `APPROVED_MIGRATION=yes`, deploy the approved images, check readiness and run non-destructive verification.
5. If app rollback is needed, use the previous compatible image. Do not automatically reverse SQL migrations, delete volumes or reset data. Data restoration is a separately authorized incident procedure, preferably into a new database first.

Stop containers with `docker compose ... stop`. Never use `down -v`, schema push or a demo reset on live volumes. Rotate credentials using a reviewed plan and keep restore-required secrets separately backed up.
