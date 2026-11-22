# Backup, off-server copy and isolated restore

A CSV export is not a backup. The app deliberately says backup monitoring is **Not connected**. No live/off-server schedule has been enabled. Local backup and restore drills have been executed only on fictional data; see TEST_RESULTS.md.

## What is backed up

`scripts/backup.ts` uses PostgreSQL 18 `pg_dump -Fc`, freezes organization financial writes through the same advisory locks, copies referenced private evidence files, and records exact account totals, counts, attachment hashes, membership permission snapshots and an audit-content hash. The backup directory is private. Authentication password hashes/session data are in the database dump and must be protected as secrets. They are excluded from the separate portability export.

Back up application environment/secrets, operational documentation and encryption-key recovery information separately under controlled access. They are not printed or included in public demo data. Restore requires the compatible app/migrations, auth secret and private attachment storage. Monitor backup age, off-server-copy success, disk use and restore drills; a successful dump alone is not proof of recovery.

## Local fictional backup and drill

Use the demo/test environment only and PostgreSQL 18 client tools:

```sh
PG_BIN=/path/to/postgresql18/bin bun --no-env-file --env-file=.env run backup
RESTORE_SOURCE=/absolute/private/backup/directory PG_BIN=/path/to/postgresql18/bin bun --no-env-file --env-file=.env run restore:drill
```

The drill accepts only demo/test mode and a loopback PostgreSQL host. It creates a unique `family_ledger_drill_<id>_restore` database. It does not replace an existing database or run `--clean`. It restores evidence into a new private `.local/restore-attachments/<database>` directory. It verifies exact journal-derived account balances, document/member/evidence/audit counts, permission contents, audit hash and every evidence checksum. The database/files remain for inspection; there is no automatic destructive cleanup.

Test login permissions and attachment authorization in an isolated app using the restored database/attachments and compatible secret. Revocation/logout/private-file checks are also covered separately by integration/browser/evidence tests. Do not expose a restored real-business backup as a public demo. Review retention before manually removing any isolated drill data.

## VPS backup operations image

`infra/Dockerfiles/operations` combines the app/Bun scripts with PostgreSQL 18 client tools. The optional `compose.operations.yaml` overlay mounts private evidence read-only and an explicitly configured host backup directory. Run as the same UID as the API (1000) so private evidence stays private. Create the dedicated host backup directory with owner UID/GID 1000 and mode 0700; do not change ownership of an unrelated directory.

After the owner approves the operational plan:

```sh
docker compose --env-file .env.production -f infra/compose.yaml -f infra/compose.operations.yaml --profile operations build operations
docker compose --env-file .env.production -f infra/compose.yaml -f infra/compose.operations.yaml --profile operations run --rm -e APPROVED_BACKUP=yes operations
```

The database stays on its private network. A host port is not opened for backup. A local directory on the VPS is not an off-server backup.

## Encryption, off-server copy and schedule

`infra/backup-offsite.sh` performs the configured operations backup, encrypts the completed directory with an approved GPG recipient, and copies the encrypted archive using SSH/rsync to the owner-approved `BACKUP_OFFSITE_DESTINATION`. It requires explicit configuration and performs no automatic deletion. Do not set a destination until the owner approves where financial data will be stored. Protect SSH keys, recipient verification and recovery keys separately. No destination, bank connection, paid service or real financial transfer has been configured.

The supplied systemd service/timer runs daily at 02:00 Asia/Kolkata after installation by an authorized operator. Configure private `/etc/family-ledger/backup.env` with `LEDGER_DIR`, `BACKUP_HOST_DIR`, `BACKUP_GPG_RECIPIENT`, `BACKUP_OFFSITE_DESTINATION`, and the private Compose environment file described in DEPLOYMENT.md. Install the service/timer under `/etc/systemd/system`, run `systemctl daemon-reload`, and enable/start the timer only after authorization. Check `systemctl list-timers`, the service journal and a verified off-server archive. Alert on failure/missed runs. The app is not wired to these service results and must not display a green backup badge.

Agree recovery-point and recovery-time targets with the owner; daily backup is a minimum proposed starting point, not an assumed acceptable loss window. Decide encrypted retention/versioning and more frequent recovery if needed. Conduct and record periodic isolated restore drills and a drill before live use.

## Incident restoration

Do not run the automated local drill against production or replace production automatically. During an incident, obtain authorization, preserve the current database/files for investigation, verify the backup source and encryption integrity, restore into a new private database and attachment directory, verify balances/permissions/audit/evidence, test access revocation and auth configuration, and approve a cutover plan. Reconcile any transactions since the backup. Only then switch the app to the restored data with an approved downtime/recovery plan. Never delete the original or the only good backup as a shortcut.
