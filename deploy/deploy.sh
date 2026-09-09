#!/usr/bin/env bash
# OwnPay one-shot VPS deploy/update. Run from the repo's deploy/ directory.
#   ./deploy.sh
# Builds and (re)starts the web + caddy stack, then shows status.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Run:  cp .env.example .env  and edit it first." >&2
  exit 1
fi

# Pull latest if this is a git checkout (ignore if not / no remote).
git -C .. pull --ff-only 2>/dev/null || true

docker compose up -d --build
echo
docker compose ps
echo
echo "Logs:  docker compose logs -f web"
