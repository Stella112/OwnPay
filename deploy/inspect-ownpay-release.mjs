// Read-only, selected public process metadata. Never print PM2 environment secrets.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const selected = processes.filter(p => ['ownpay-web', 'ownpay-agent', 'ownpay-robinhood-preview'].includes(p.name)).map(p => ({ name: p.name, pid: p.pid, status: p.pm2_env.status, script: p.pm2_env.pm_exec_path, cwd: p.pm2_env.pm_cwd }));
const build = '/opt/ownpay/releases/robinhood-20261003/web/.next-robinhood-20261003';
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), processes: selected, buildId: fs.readFileSync(`${build}/BUILD_ID`, 'utf8').trim(), startupPersistence: 'Shared PM2 snapshot saved with explicit owner approval; reboot recovery not tested' }, null, 2));
