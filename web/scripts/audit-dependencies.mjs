import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
function run(command) {
  let raw;
  try { raw = execSync(command, { encoding: 'utf8' }); }
  catch(e) { raw = e.stdout; }
  const result = JSON.parse(raw);
  if (!result.metadata?.vulnerabilities || !result.vulnerabilities) {
    throw new Error('Dependency audit unavailable; previous evidence preserved. Retry with registry access.');
  }
  return result;
}
const audit = run('npm audit --json');
const production = run('npm audit --omit=dev --json');
const report = { checkedAt: new Date().toISOString(), counts: audit.metadata.vulnerabilities,
  productionCounts: production.metadata.vulnerabilities,
  advisories: Object.values(audit.vulnerabilities).map(v => ({ name: v.name, severity: v.severity, nodes: v.nodes, via: v.via, fixAvailable: v.fixAvailable })) };
await fs.mkdir('../docs/evidence', { recursive: true });
await fs.writeFile('../docs/evidence/dependency-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ all: report.counts, production: report.productionCounts }));
if (report.counts.critical || report.counts.high) process.exitCode = 1;
