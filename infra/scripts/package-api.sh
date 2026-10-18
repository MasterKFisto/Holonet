#!/usr/bin/env bash
#
# Packages the holonet-app Function Compute artifact.
#
# Bundles apps/api/src/function.ts (the FC HTTP entrypoint) together with all
# workspace packages into a single self-contained CommonJS zip at
# infra/alibaba/dist/holonet-app.zip. The dashboard asset manifest
# (infra/alibaba/dashboard-assets.json, written by upload-dashboard-assets.mjs)
# is baked into the zip and referenced via DASHBOARD_ASSET_MANIFEST_PATH=./dashboard-assets.json
# (see infra/alibaba/s.yaml).
#
# Usage:
#   bash infra/scripts/package-api.sh
#
# Requires Node.js 20+, pnpm, esbuild (installed as a repo devDependency), zip.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/infra/alibaba/dist/holonet-app"

echo "== Packaging holonet-app =="

command -v zip >/dev/null 2>&1 || { echo "ERROR: 'zip' is required."; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Bundle the FC entrypoint (self-contained CommonJS; Node builtins stay external).
pnpm --dir "$ROOT_DIR" exec esbuild apps/api/src/function.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile="$OUT_DIR/index.js" \
  --external:proxy-agent \
  --log-level=warning

# CommonJS module (no "type": "module") so FC's nodejs20 runtime loads
# exports.handler directly.
printf '{"name":"holonet-app","main":"index.js"}\n' > "$OUT_DIR/package.json"

# Bake the dashboard asset manifest when it exists (upload-dashboard-assets.mjs
# writes it). In production mode (--production, used by deploy.sh) a missing
# manifest is a hard error — the runtime can still fall back to the OSS copy,
# but production packages must be self-contained.
PRODUCTION_MODE=false
if [[ "${1:-}" == "--production" ]]; then
  PRODUCTION_MODE=true
fi

MANIFEST="$ROOT_DIR/infra/alibaba/dashboard-assets.json"
if [[ -f "$MANIFEST" ]]; then
  cp "$MANIFEST" "$OUT_DIR/dashboard-assets.json"
  echo "OK: dashboard-assets.json baked in"
elif [[ "$PRODUCTION_MODE" == "true" ]]; then
  echo "ERROR: infra/alibaba/dashboard-assets.json is missing." >&2
  echo "       Production packages must bake the dashboard asset manifest." >&2
  echo "       Run: node infra/scripts/upload-dashboard-assets.mjs" >&2
  echo "       (or: pnpm dashboard:upload), then package again." >&2
  exit 1
else
  echo "NOTE: no dashboard-assets.json — the runtime will fall back to the OSS" 
  echo "      bucket key app/dashboard-assets.json (upload-dashboard-assets.mjs)."
fi

# Self-contained zip with the entrypoint at the archive root.
(cd "$OUT_DIR" && zip -qr "../holonet-app.zip" .)
echo "OK: infra/alibaba/dist/holonet-app.zip"