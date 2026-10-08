#!/usr/bin/env bash
#
# Holonet deployment readiness check.
#
# Usage:
#   deploy-check.sh             local tooling check (always passes locally)
#   deploy-check.sh --production   additionally verifies production env vars
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "== Holonet deploy check =="

# 1. Tooling
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required (Node.js 20)."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "ERROR: Node.js 20+ required, found $NODE_MAJOR."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm is required."; exit 1; }
echo "OK: node $(node -v), pnpm $(pnpm -v)"

# 2. Production environment variables
if [[ "${1:-}" == "--production" ]]; then
  if [[ -f "$ROOT_DIR/.env" ]]; then
    # Import KEY=VALUE lines safely (NOT shell-sourced: values may contain
    # '<PLACEHOLDER>' tokens that are not shell-safe). Variables already in
    # the environment win.
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
    done < "$ROOT_DIR/.env"
  fi

  required_vars=(
    ALIBABA_CLOUD_REGION
    ALIBABA_CLOUD_ACCOUNT_ID
    OSS_PUBLIC_BUCKET
    OSS_PRIVATE_BUCKET
    AUTH_SECRET
    FC_ROLE_ARN
    VPC_ID
    VSWITCH_IDS
    SECURITY_GROUP_ID
  )

  failed=0
  for var in "${required_vars[@]}"; do
    value="${!var:-}"
    if [[ -z "$value" || "$value" == *"<"* ]]; then
      echo "ERROR: $var is unset or still a placeholder."
      failed=1
    fi
  done

  if [[ "$failed" -eq 0 ]]; then
    echo "OK: production environment variables present."
  fi
  exit "$failed"
fi

echo "NOTE: run with --production to also verify Alibaba Cloud environment variables."
