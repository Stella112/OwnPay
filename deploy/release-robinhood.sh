#!/usr/bin/env bash
# Build and promote a NEW side-by-side Robinhood release of ownpay-web ONLY.
#
#   bash deploy/release-robinhood.sh /opt/ownpay/releases/robinhood-<stamp>
#
# - Builds into an isolated directory; the live release keeps serving meanwhile.
# - Records whatever ownpay-web is CURRENTLY running (read from PM2, not assumed)
#   and restores exactly that if the new release fails its smoke test.
# - Never touches the Base ownpay-agent or any other PM2 process.
set -euo pipefail

ROOT="${1:?usage: release-robinhood.sh /opt/ownpay/releases/<name>}"
case "$ROOT" in /opt/ownpay/releases/*) ;; *) echo "Refusing release dir outside /opt/ownpay/releases: $ROOT" >&2; exit 1;; esac
test -d "$ROOT/web" && test -f "$ROOT/deploy/ecosystem.ownpay.config.cjs"
BUILD=".next-$(basename "$ROOT")"
ECOSYSTEM="$ROOT/deploy/ecosystem.ownpay.config.cjs"

set -a
. /opt/ownpay/deploy/.env
if [ -f /opt/ownpay/deploy/robinhood.env ]; then . /opt/ownpay/deploy/robinhood.env; fi
set +a
export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-${PRIVY_KEY_QUORUM_ID:-}}"
export NEXT_TELEMETRY_DISABLED=1

# ---- 1. Build (isolated; live release untouched) --------------------------------
cd "$ROOT/web"
npm ci --ignore-scripts --no-audit --no-fund
OWNPAY_BUILD_DIR="$BUILD" OWNPAY_LOW_MEMORY_BUILD=true NODE_OPTIONS=--max-old-space-size=1024 \
  nice -n 10 npm run build:vps
test -f "$ROOT/web/$BUILD/standalone/server.js"
echo "BUILD_OK $ROOT/web/$BUILD"

# ---- 2. Capture the currently running ownpay-web for rollback --------------------
read -r OLD_CWD OLD_SCRIPT < <(pm2 jlist | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const p=JSON.parse(s).find(x=>x.name==="ownpay-web"); if(!p) process.exit(2);
    console.log(p.pm2_env.pm_cwd, p.pm2_env.pm_exec_path); });')
case "$OLD_SCRIPT" in /opt/ownpay/*/standalone/server.js) ;; *) echo "Unexpected live script: $OLD_SCRIPT; nothing changed." >&2; exit 1;; esac
OLD_BUILD=$(basename "$(dirname "$(dirname "$OLD_SCRIPT")")")
echo "LIVE_BEFORE cwd=$OLD_CWD build=$OLD_BUILD"

# Keep the previous release's hashed chunks reachable for already-open tabs.
if [ -d "$OLD_CWD/$OLD_BUILD/static" ]; then
  cp -an "$OLD_CWD/$OLD_BUILD/static/." "$ROOT/web/$BUILD/standalone/$BUILD/static/"
fi

export NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3102 OWNPAY_PORT=3102 NODE_OPTIONS=--max-old-space-size=512

rollback() {
  trap - ERR
  echo "Smoke test failed; restoring $OLD_CWD ($OLD_BUILD)." >&2
  pm2 delete ownpay-web >/dev/null 2>&1 || true
  OWNPAY_WEB_ROOT="$OLD_CWD" OWNPAY_BUILD_DIR="$OLD_BUILD" pm2 start "$ECOSYSTEM" --only ownpay-web >/dev/null
  echo "ROLLED_BACK"
}

# ---- 3. Swap ownpay-web only, verify, or roll back -------------------------------
trap rollback ERR
pm2 delete ownpay-web >/dev/null
OWNPAY_WEB_ROOT="$ROOT/web" OWNPAY_BUILD_DIR="$BUILD" pm2 start "$ECOSYSTEM" --only ownpay-web
for _ in $(seq 1 30); do
  if curl --max-time 5 -fsS http://127.0.0.1:3102/robinhood >/dev/null; then break; fi
  sleep 1
done
OWNPAY_SMOKE_ORIGIN=http://127.0.0.1:3102 node scripts/smoke-robinhood.mjs
trap - ERR

# Persist so a reboot brings back this release (owner-authorized shared snapshot).
pm2 save
echo "PROMOTED $ROOT/web/$BUILD (previous: $OLD_CWD/$OLD_BUILD kept for rollback)"
