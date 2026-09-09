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
