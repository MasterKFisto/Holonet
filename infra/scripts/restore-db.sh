#!/usr/bin/env bash
#
# Restores the Holonet PostgreSQL database from a pg_dump custom-format file.
#
# Usage: restore-db.sh <dump-file>
# Requires DATABASE_URL in the environment (see .env.example).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (see .env.example)}"
DUMP_FILE="${1:?Usage: restore-db.sh <dump-file>}"

pg_restore --no-owner --dbname="$DATABASE_URL" "$DUMP_FILE"
echo "Restored $DUMP_FILE"
