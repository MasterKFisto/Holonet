#!/usr/bin/env bash
#
# Holonet Function Compute deployment (Serverless Devs).
#
# Usage:
#   bash infra/scripts/deploy.sh [--skip-dashboard]
#
# Prerequisites (see infra/alibaba/README.md):
#   1. Node.js 20+, pnpm, zip, and the Serverless Devs CLI (`s`, installed via
#      `npm i -g @serverless-devs/s`).
#   2. An access profile: s config add --AccessKeyID <AK> --AccessKeySecret <SK> -a holonet
#   3. infra/alibaba/.env.deploy (copy of .env.deploy.example) with real values.
#
# The script:
#   1. Loads infra/alibaba/.env.deploy (real secrets — never committed).
#   2. Runs the deployment readiness check (--production).
#   3. Uploads the dashboard SPA assets to the OSS public bucket.
#   4. Packages both function artifacts (esbuild bundles + zip).
#   5. Deploys holonet-app + holonet-builder via `s deploy` (s.yaml).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/alibaba/.env.deploy"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  echo "  cp infra/alibaba/.env.deploy.example infra/alibaba/.env.deploy"
  echo "  # then fill in the placeholders (never commit it)."
  exit 1
fi

# Import KEY=VALUE lines safely (values may contain ':' or '@' — no shell
# sourcing). Variables already exported in the environment win.
while IFS= read -r line; do
  case "$line" in
    '' | '#'*) continue ;;
    *=*)
      key="${line%%=*}"
      if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && [[ -z "${!key:-}" ]]; then
        export "$key=${line#*=}"
      fi
      ;;
  esac
done < "$ENV_FILE"

# 1. Readiness check (tooling + production env vars + platform hostname).
bash "$ROOT_DIR/infra/scripts/deploy-check.sh" --production

# 2. Dashboard assets (skip with --skip-dashboard).
if [[ "${1:-}" != "--skip-dashboard" ]]; then
  echo "== Uploading dashboard assets =="
  pnpm --dir "$ROOT_DIR" build --filter @holonet/dashboard
  node "$ROOT_DIR/infra/scripts/upload-dashboard-assets.mjs"
fi

# 3. Function artifacts (production-strict: the dashboard manifest must be
#    baked into the app zip).
bash "$ROOT_DIR/infra/scripts/package-api.sh" --production
bash "$ROOT_DIR/infra/scripts/package-builder.sh"

# 4. Serverless Devs deploy (s.yaml reads the exported env vars).
echo "== Deploying Function Compute (s deploy) =="
command -v s >/dev/null 2>&1 || {
  echo "ERROR: Serverless Devs CLI not found. Install it:"
  echo "  npm install -g @serverless-devs/s"
  echo "  s config add --AccessKeyID <AK> --AccessKeySecret <SK> -a holonet"
  exit 1
}
(cd "$ROOT_DIR/infra/alibaba" && s deploy --access holonet -y)

echo "== Deployment complete =="
echo "Verify:"
echo "  curl -i https://holonet.section-zero.link/health"
echo "  curl -i https://holonet.section-zero.link/api/health"
echo "  s holonet-builder invoke  # remote builder invocation (see infra/alibaba/README.md)"