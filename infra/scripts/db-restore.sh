#!/usr/bin/env bash
#
# Restores the Holonet local database from a backup file.
# Accepts plain SQL or the gzip output produced by db-backup.sh.
#
# Usage: db-restore.sh <backup-file>
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DUMP_FILE="${1:?Usage: db-restore.sh <backup-file>}"
[[ -f "$DUMP_FILE" ]] || { echo "ERROR: backup file not found: $DUMP_FILE"; exit 1; }

COMPOSE="docker compose -f $ROOT_DIR/infra/docker/docker-compose.yml"

if [[ "$DUMP_FILE" == *.gz ]]; then
  gzip -dc "$DUMP_FILE" | $COMPOSE exec -T db psql -U holonet -d holonet -v ON_ERROR_STOP=1
else
  $COMPOSE exec -T db psql -U holonet -d holonet -v ON_ERROR_STOP=1 < "$DUMP_FILE"
fi

echo "Restored $DUMP_FILE"
