#!/usr/bin/env bash
# Deploy/update OwnPay beside existing VPS services (Apex-safe).
# Run from the repository's deploy/ directory.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Run: cp .env.example .env and edit it first." >&2
  exit 1
fi

OWNPAY_PORT="${OWNPAY_PORT:-3102}"
if ! [[ "$OWNPAY_PORT" =~ ^[0-9]+$ ]] || [ "$OWNPAY_PORT" -lt 1024 ] || [ "$OWNPAY_PORT" -gt 65535 ]; then
  echo "OWNPAY_PORT must be an unused TCP port between 1024 and 65535 (default: 3102)." >&2
  exit 1
fi

# Fail before Docker changes anything if another host process already owns the
# dedicated loopback port. This script never stops or recreates other stacks.
existing_ownpay="$(docker compose -p ownpay -f docker-compose.shared.yml ps -q web 2>/dev/null || true)"
if [ -z "$existing_ownpay" ] && command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${OWNPAY_PORT}$"; then
  echo "Port ${OWNPAY_PORT} is already in use; refusing to deploy OwnPay." >&2
  exit 1
fi

docker compose -p ownpay -f docker-compose.shared.yml up -d --build
echo
docker compose -p ownpay -f docker-compose.shared.yml ps
echo
echo "OwnPay is listening on 127.0.0.1:${OWNPAY_PORT}."
echo "Add the existing proxy route from docs/VPS.md, then test the public hostname."
