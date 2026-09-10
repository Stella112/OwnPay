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
npm --prefix web run build

# Next's standalone server does not copy these folders automatically. Keep the
# generated server self-contained so CSS, optimized images, and public assets
# work when PM2 launches web/.next/standalone/server.js.
if [ -d web/.next/standalone ]; then
  mkdir -p web/.next/standalone/.next/static web/.next/standalone/public
  cp -R web/.next/static/. web/.next/standalone/.next/static/
  cp -R web/public/. web/.next/standalone/public/
fi

pm2 startOrRestart deploy/ecosystem.ownpay.config.cjs --update-env
pm2 save

echo
pm2 status ownpay-web
echo "OwnPay is listening on 127.0.0.1:${OWNPAY_PORT:-3102}."
