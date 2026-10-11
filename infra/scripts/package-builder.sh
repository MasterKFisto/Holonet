#!/usr/bin/env bash
#
# Packages the holonet-builder Function Compute artifact.
#
# Bundles apps/builder/src/handler.ts (the FC event entrypoint) together with
# all workspace packages into a single self-contained CommonJS zip at
# infra/alibaba/dist/holonet-builder.zip.
#
# Usage:
#   bash infra/scripts/package-builder.sh
#
# Requires Node.js 20+, pnpm, esbuild (repo devDependency), zip.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/infra/alibaba/dist/holonet-builder"

echo "== Packaging holonet-builder =="

command -v zip >/dev/null 2>&1 || { echo "ERROR: 'zip' is required."; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

pnpm --dir "$ROOT_DIR" exec esbuild apps/builder/src/handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile="$OUT_DIR/index.js" \
  --external:proxy-agent \
  --log-level=warning

printf '{"name":"holonet-builder","main":"index.js"}\n' > "$OUT_DIR/package.json"

(cd "$OUT_DIR" && zip -qr "../holonet-builder.zip" .)
echo "OK: infra/alibaba/dist/holonet-builder.zip"