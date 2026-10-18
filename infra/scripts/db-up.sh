#!/usr/bin/env bash
#
# Starts the Holonet local development database (PostgreSQL 16 in Docker)
# and waits until it is healthy.
#
# POSTGRES_PASSWORD can be supplied via the environment; the compose file
# falls back to a local-development-only default (see
# infra/docker/docker-compose.yml).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="$ROOT_DIR/infra/docker"

# Import the variables the compose file needs from the repository-root .env
# (if present). The file is NOT shell-sourced: values may contain
# angle-bracket template tokens that are not shell-safe. Variables already in
# the environment win.
if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line; do
    case "$line" in
      POSTGRES_PASSWORD=*)
        [[ -z "${POSTGRES_PASSWORD:-}" ]] && export POSTGRES_PASSWORD="${line#POSTGRES_PASSWORD=}"
        ;;
      DB_PORT=*)
        [[ -z "${DB_PORT:-}" ]] && export DB_PORT="${line#DB_PORT=}"
        ;;
    esac
  done < "$ROOT_DIR/.env"
fi

cd "$COMPOSE_DIR"
docker compose -f docker-compose.yml up -d --wait "$@"
echo "Holonet database is up."
echo "psql: docker compose -f infra/docker/docker-compose.yml exec db psql -U holonet -d holonet"

