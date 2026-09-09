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

npm --prefix web ci
npm --prefix web run build
pm2 startOrRestart deploy/ecosystem.ownpay.config.cjs --update-env
pm2 save

echo
pm2 status ownpay-web
echo "OwnPay is listening on 127.0.0.1:${OWNPAY_PORT:-3102}."
