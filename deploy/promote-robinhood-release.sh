#!/usr/bin/env bash
# Promote only ownpay-web. Do not restart the Base agent or shared services.
set -euo pipefail
ROOT=/opt/ownpay/releases/robinhood-20261003
test -f "$ROOT/web/.next-robinhood-20261003/standalone/server.js"
OLD_SCRIPT=$(pm2 jlist | node -e "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const p=JSON.parse(s).find(p=>p.name==='ownpay-web');if(!p)process.exit(1);console.log(p.pm2_env.pm_exec_path)})")
OLD_CWD=$(pm2 jlist | node -e "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{console.log(JSON.parse(s).find(p=>p.name==='ownpay-web').pm2_env.pm_cwd)})")
test "$OLD_CWD" = /opt/ownpay/web
case "$OLD_SCRIPT" in /opt/ownpay/web/.next*/standalone/server.js) ;; *) echo 'Unexpected previous release; no service changed.' >&2; exit 1;; esac
OLD_BUILD=$(basename "$(dirname "$(dirname "$OLD_SCRIPT")")")
set -a
. /opt/ownpay/deploy/.env
if [ -f /opt/ownpay/deploy/robinhood.env ]; then . /opt/ownpay/deploy/robinhood.env; fi
set +a
export NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3102 OWNPAY_PORT=3102
export NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID="${NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID:-${PRIVY_KEY_QUORUM_ID:-}}"
export NODE_OPTIONS=--max-old-space-size=512
rollback() {
  trap - ERR
  echo 'Frontend smoke failed; restoring the previous OwnPay release.' >&2
  export OWNPAY_WEB_ROOT="$OLD_CWD" OWNPAY_BUILD_DIR="$OLD_BUILD"
  pm2 delete ownpay-web >/dev/null 2>&1 || true
  pm2 start "$ROOT/deploy/ecosystem.ownpay.config.cjs" --only ownpay-web >/dev/null
}
export OWNPAY_WEB_ROOT="$ROOT/web" OWNPAY_BUILD_DIR=.next-robinhood-20261003
if [ -d "$OLD_CWD/$OLD_BUILD/static" ]; then
  cp -an "$OLD_CWD/$OLD_BUILD/static/." "$ROOT/web/.next-robinhood-20261003/standalone/.next-robinhood-20261003/static/"
fi
trap rollback ERR
# PM2 reload retains the existing script/cwd. Recreate ONLY this named process
# to select the tested release; rollback retains the previous files and config.
pm2 delete ownpay-web >/dev/null
pm2 start "$ROOT/deploy/ecosystem.ownpay.config.cjs" --only ownpay-web
for attempt in $(seq 1 20); do
  if curl --max-time 5 -fsS http://127.0.0.1:3102/robinhood >/dev/null; then break; fi
  sleep 1
done
cd "$ROOT/web"
OWNPAY_SMOKE_ORIGIN=http://127.0.0.1:3102 node scripts/smoke-robinhood.mjs
trap - ERR
echo OWNPAY_FRONTEND_PROMOTED_CONTRACTS_STILL_UNCONFIGURED
