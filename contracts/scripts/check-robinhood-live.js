// Read-only independent explorer confirmation and public frontend snapshot.
const fs = require('node:fs');
const path = require('node:path');
const { parseUnits } = require('ethers');
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/robinhood-testnet.json')));
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/evidence/robinhood-demo.json')));
  const workerPath = path.join(__dirname, '../../docs/evidence/robinhood-worker.json');
  const worker = fs.existsSync(workerPath) ? JSON.parse(fs.readFileSync(workerPath)) : null;
  if (worker && worker.status !== 'completed') throw new Error('Worker rehearsal not complete');
  const hashes = [...Object.values(manifest.transactions), ...demo.transactions.map(t => t.hash), ...(worker?.transactions.map(t => t.hash) || [])];
  const receipts = [];
  for (const hash of hashes) {
    const response = await fetch(`https://explorer.testnet.chain.robinhood.com/api/v2/transactions/${hash}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Explorer HTTP ${response.status} for ${hash}`);
    const body = await response.json();
    if (body.status !== 'ok' || body.hash.toLowerCase() !== hash.toLowerCase()) throw new Error(`Explorer did not confirm success for ${hash}`);
    receipts.push({ hash: body.hash, status: body.status, block: body.block_number });
  }
  const response = await fetch(`https://ownpay.online/api/robinhood/status?owner=${demo.owner}`, { signal: AbortSignal.timeout(45000) });
  const snapshot = await response.json();
  const expectedAsset = BigInt(demo.finalBalances.demoAssetRaw) + (worker ? parseUnits(worker.split.demoOwn,18) : 0n);
  if (!response.ok || snapshot.router?.toLowerCase() !== manifest.ownRules.toLowerCase() || snapshot.assetBalance !== String(expectedAsset) || !snapshot.grants?.some(g => g.released === demo.vesting.totalRaw)) throw new Error('Public frontend does not match confirmed demo state');
  const evidence = { checkedAt: new Date().toISOString(), chainId: 46630, explorerReceipts: receipts, frontend: { httpStatus: response.status, router: snapshot.router, owner: demo.owner, demoAssetBalanceRaw: snapshot.assetBalance, grants: snapshot.grants, relayEnabled: snapshot.relayEnabled, historyWarning: snapshot.historyWarning }, sponsorshipVerified: false, scope: 'Explorer receipts and public API; not browser email-login verification' };
  fs.writeFileSync(path.join(__dirname, '../../docs/evidence/robinhood-live.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
