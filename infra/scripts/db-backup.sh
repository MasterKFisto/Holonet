#!/usr/bin/env bash
#
# Backs up the Holonet local database with pg_dump (plain SQL, gzip).
# Output: backups/database/holonet-db-YYYYMMDD-HHMMSS.sql.gz
#
# Usage: db-backup.sh [backup-dir]   (default: <repo>/backups/database)
# pg_dump runs inside the db container, so no host PostgreSQL client is needed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/backups/database}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/holonet-db-$STAMP.sql.gz"

docker compose -f "$ROOT_DIR/infra/docker/docker-compose.yml" exec -T db \
  pg_dump -U holonet -d holonet --no-owner | gzip > "$OUT"

echo "Backup written to $OUT"
