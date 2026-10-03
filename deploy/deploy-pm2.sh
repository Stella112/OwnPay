#!/usr/bin/env bash
# Deploy/update OwnPay on the shared Qevor VPS without touching other PM2 apps.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/.env ]; then
  echo "No deploy/.env found. Copy deploy/.env.example and configure it first." >&2
  exit 1
fi

# NEXT_PUBLIC_* values are inlined by Next.js during this build only.
set -a
. deploy/.env
set +a

# The quorum ID is safe to expose to the browser because it identifies the
# signer grant; the private key and app secret remain server-only. Allow the
# VPS env to keep one canonical value while still inlining the public ID into
# the Next.js build.
if [ -z "${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-}" ] && [ -n "${PRIVY_KEY_QUORUM_ID:-}" ]; then
  export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="$PRIVY_KEY_QUORUM_ID"
fi

npm --prefix web ci --legacy-peer-deps
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}" npm --prefix web run build:vps

# build:vps already copies static/public into the selected standalone output.

pm2 startOrRestart deploy/ecosystem.ownpay.config.cjs --update-env
pm2 save

echo
pm2 status ownpay-web
echo "OwnPay is listening on 127.0.0.1:${OWNPAY_PORT:-3102}."
