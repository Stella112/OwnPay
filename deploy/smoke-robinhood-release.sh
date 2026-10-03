#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/ownpay/releases/robinhood-20261003
test -f "$ROOT/web/.next-robinhood-20261003/standalone/server.js"
if pm2 describe ownpay-robinhood-preview >/dev/null 2>&1; then
  echo 'Preview process already exists; inspect before replacing it.' >&2; exit 1
fi
if ss -ltn 'sport = :3104' | tail -n +2 | grep -q .; then
  echo 'Preview port is occupied; no process changed.' >&2; exit 1
fi
set -a
. /opt/ownpay/deploy/.env
if [ -f /opt/ownpay/deploy/robinhood.env ]; then . /opt/ownpay/deploy/robinhood.env; fi
set +a
export NODE_OPTIONS=--max-old-space-size=512
pm2 start "$ROOT/deploy/ecosystem.robinhood-preview.config.cjs" --only ownpay-robinhood-preview
trap 'pm2 delete ownpay-robinhood-preview >/dev/null 2>&1 || true' EXIT
for attempt in $(seq 1 20); do
  if curl --max-time 5 -fsS http://127.0.0.1:3104/robinhood >/dev/null; then break; fi
  sleep 1
done
cd "$ROOT/web"
node scripts/smoke-robinhood.mjs
