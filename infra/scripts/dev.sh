#!/usr/bin/env bash
#
# Starts local infrastructure (PostgreSQL via Docker Compose) and then the
# development servers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Starting PostgreSQL (Docker)..."
docker compose -f "$ROOT_DIR/infra/docker/docker-compose.yml" up -d

echo "Starting development servers..."
pnpm --dir "$ROOT_DIR" dev
