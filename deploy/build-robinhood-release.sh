#!/usr/bin/env bash
# Isolated release: leaves the running Base service and agent untouched.
set -euo pipefail
ROOT=/opt/ownpay/releases/robinhood-20261003
test -d "$ROOT/web"
set -a
. /opt/ownpay/deploy/.env
if [ -f /opt/ownpay/deploy/robinhood.env ]; then . /opt/ownpay/deploy/robinhood.env; fi
set +a
export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-${PRIVY_KEY_QUORUM_ID:-}}"
export OWNPAY_BUILD_DIR=.next-robinhood-20261003
export NODE_OPTIONS=--max-old-space-size=1024
export OWNPAY_LOW_MEMORY_BUILD=true
export NEXT_TELEMETRY_DISABLED=1
cd "$ROOT/web"
if [ "${1:-}" = "--refresh-installed" ]; then
  npm install --ignore-scripts --no-audit --no-fund
elif [ "${1:-}" = "--reuse-installed" ]; then
  test "$(node -p 'require("next/package.json").version')" = "16.3.8"
else
  npm ci --ignore-scripts --no-audit --no-fund
fi
nice -n 10 npm run build:vps
echo OWNPAY_ROBINHOOD_FRONTEND_BUILD_COMPLETE
