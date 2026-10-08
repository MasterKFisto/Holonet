#!/usr/bin/env bash
#
# Stops the Holonet local development database.
# Data in the holonet_db_data volume is preserved; use `down -v` to delete it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/infra/docker"
docker compose -f docker-compose.yml down "$@"
