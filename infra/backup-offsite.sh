#!/usr/bin/env bash
set -euo pipefail
# Install only after the owner approves destination, retention and recovery targets.
: "${LEDGER_DIR:?Set installed repository directory}"
: "${BACKUP_HOST_DIR:?Set the private backup directory}"
: "${BACKUP_GPG_RECIPIENT:?Set the approved encryption-key fingerprint}"
: "${BACKUP_OFFSITE_DESTINATION:?Set the approved SSH rsync destination}"
cd "$LEDGER_DIR"
docker compose --env-file .env.production -f infra/compose.yaml -f infra/compose.operations.yaml --profile operations run --rm -e APPROVED_BACKUP=yes operations
latest_backup="$(find "$BACKUP_HOST_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -print | sort | tail -n 1)"
[[ -n "$latest_backup" && -f "$latest_backup/database.dump" && -f "$latest_backup/manifest.json" ]]
backup_name="$(basename "$latest_backup")"
encrypted_backup="$BACKUP_HOST_DIR/$backup_name.tar.gpg"
tar -C "$BACKUP_HOST_DIR" -cf - "$backup_name" | gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$encrypted_backup"
chmod 600 "$encrypted_backup"
rsync --checksum -- "$encrypted_backup" "$BACKUP_OFFSITE_DESTINATION"
printf '%s\n' "Encrypted backup copied off-server. Restore verification remains a separate operation."
# No automatic deletion policy: configure approved retention separately; never erase the only backup.
