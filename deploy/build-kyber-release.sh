#!/usr/bin/env bash
# Compile separately; never restart a live service from this script.
set -euo pipefail
cd /opt/ownpay
set -a
. deploy/.env
set +a
export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-$PRIVY_KEY_QUORUM_ID}"
export OWNPAY_BUILD_DIR=.next-kyber-20261001
export NODE_OPTIONS=--max-old-space-size=768
export NEXT_TELEMETRY_DISABLED=1
cd web
nice -n 10 npm run build:vps
echo OWNPAY_KYBER_BUILD_COMPLETE
