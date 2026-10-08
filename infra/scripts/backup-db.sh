#!/usr/bin/env bash
#
# Backs up the Holonet PostgreSQL database with pg_dump (custom format).
#
# Usage: backup-db.sh [backup-dir]   (default: ./backups)
# Requires DATABASE_URL in the environment (see .env.example).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (see .env.example)}"

BACKUP_DIR="${1:-$(pwd)/backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/holonet-$STAMP.dump"

pg_dump --format=custom --no-owner --file="$OUT" "$DATABASE_URL"
echo "Backup written to $OUT"
