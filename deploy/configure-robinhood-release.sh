#!/usr/bin/env bash
# Only configure the existing tested web release; never restart the Base agent.
set -euo pipefail
ROOT=/opt/ownpay/releases/robinhood-20261003
test -f /opt/ownpay/deploy/robinhood.env
set -a
. /opt/ownpay/deploy/.env
. /opt/ownpay/deploy/robinhood.env
set +a
export OWNPAY_WEB_ROOT="$ROOT/web" OWNPAY_BUILD_DIR=.next-robinhood-20261003
export OWNPAY_PORT=3102 NODE_OPTIONS=--max-old-space-size=512
export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-${PRIVY_KEY_QUORUM_ID:-}}"
export ROBINHOOD_AGENT_MODE="${ROBINHOOD_AGENT_MODE:-observe}"
export ROBINHOOD_AGENT_STATE_FILE="${ROBINHOOD_AGENT_STATE_FILE:-/opt/ownpay/web/.robinhood-agent/state.json}"
export ROBINHOOD_AGENT_HEALTH_FILE="${ROBINHOOD_AGENT_HEALTH_FILE:-/opt/ownpay/web/.robinhood-agent/health.json}"
pm2 reload "$ROOT/deploy/ecosystem.ownpay.config.cjs" --only ownpay-web --update-env
for attempt in $(seq 1 20); do
  if curl --max-time 5 -fsS http://127.0.0.1:3102/robinhood >/dev/null; then break; fi
  sleep 1
done
cd "$ROOT/web"
OWNPAY_SMOKE_ORIGIN=http://127.0.0.1:3102 node scripts/smoke-robinhood.mjs
# Start the independent Robinhood worker in its safe default observe mode.
# Execute mode remains off until a dedicated signer is provisioned and funded.
pm2 startOrReload "$ROOT/deploy/ecosystem.robinhood.config.cjs" --update-env
# Shared snapshot save explicitly authorized by the owner.
pm2 save
