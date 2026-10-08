#!/usr/bin/env bash
#
# Opens a psql shell in the running Holonet local development database.
# Extra arguments are passed through to psql.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker compose -f "$ROOT_DIR/infra/docker/docker-compose.yml" exec db psql -U holonet -d holonet "$@"
