// One-shot real-testnet worker rehearsal. Temporary signer key stays in memory.
const { ethers } = require('hardhat');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verify, USDG } = require('./verify-robinhood');
async function main() {
  await verify();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/robinhood-testnet.json')));
  const [owner] = await ethers.getSigners();
  const router = await ethers.getContractAt('OwnRules', manifest.ownRules);
  const receive = await router.accounts(owner.address);
  if (receive === ethers.ZeroAddress || (await router.usdg()).toLowerCase() !== USDG.toLowerCase()) throw new Error('Receive account/token verification failed');
  const rule = await router.rules(owner.address);
  if (rule.adapter.toLowerCase() !== manifest.demoAdapter.toLowerCase()) throw new Error('Expected labeled demo adapter');
  const agent = ethers.Wallet.createRandom();
  const token = new ethers.Contract(USDG, ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], owner);
  if (await token.balanceOf(owner.address) < ethers.parseUnits('1', 6)) throw new Error('Need 1 test USDG');
  const asset = await ethers.getContractAt('DemoOwnershipUnits', manifest.demoAsset);
  const beforeAsset = await asset.balanceOf(owner.address);
  const beforeSavings = await router.savings(owner.address);
  const originalVesting = await router.vestingSeconds(owner.address);
  const evidence = { status: 'in-progress', chainId: 46630, owner: owner.address, agent: agent.address, mode: 'one-shot dedicated worker; not persistent service', transactions: [], workerEvents: [] };
  const output = path.join(__dirname, '../../docs/evidence/robinhood-worker.json');
  const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  async function tx(label, promise) { const receipt = await (await promise).wait(); if (receipt.status !== 1) throw new Error(`${label} failed`); evidence.transactions.push({ label, hash: receipt.hash, block: receipt.blockNumber }); save(); }
  try {
    await tx('Fund temporary test worker with 0.00002 test ETH', owner.sendTransaction({ to: agent.address, value: ethers.parseEther('0.00002') }));
    await tx('Use immediate demo output for worker rehearsal', router.setVestingSeconds(0));
    await tx('Authorize distinct test worker for ten minutes', router.delegate(agent.address, Math.floor(Date.now() / 1000) + 600));
    const fromBlock = await ethers.provider.getBlockNumber();
    await tx('Deposit 1 canonical test USDG for worker processing', token.transfer(receive, ethers.parseUnits('1', 6)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownpay-rh-worker-'));
    const stateFile = path.join(dir, 'state.json');
    // Seed known account from verified onchain accounts(owner), then scan new deposit logs.
    fs.writeFileSync(stateFile, JSON.stringify({ chainId: 46630, router: manifest.ownRules.toLowerCase(), nextBlock: String(fromBlock), accounts: { [receive.toLowerCase()]: owner.address }, pending: [] }), { mode: 0o600 });
    const child = spawnSync(process.execPath, [path.join(__dirname, '../../web/agent/robinhood-agent.mjs')], {
      env: { ...process.env, ROBINHOOD_TESTNET_RPC_URL: 'https://rpc.testnet.chain.robinhood.com', ROBINHOOD_OWNRULES_ADDRESS: manifest.ownRules, ROBINHOOD_AGENT_PRIVATE_KEY: agent.privateKey, ROBINHOOD_AGENT_MODE: 'execute', ROBINHOOD_AGENT_ONCE: 'true', ROBINHOOD_AGENT_STATE_FILE: stateFile },
      encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    });
    if (child.error || child.status !== 0) throw new Error(`Worker failed: ${child.error?.message || child.stderr.slice(0,500)}`);
    evidence.workerEvents = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const confirmed = evidence.workerEvents.find(e => e.event === 'income_split_confirmed');
    if (!confirmed) throw new Error(`Worker produced no confirmed split: ${child.stderr.slice(0,500)}`);
    const receipt = await ethers.provider.getTransactionReceipt(confirmed.hash);
    if (receipt.status !== 1 || receipt.from.toLowerCase() !== agent.address.toLowerCase()) throw new Error('Wrong signer or failed worker transaction');
    if (await asset.balanceOf(owner.address) !== beforeAsset + ethers.parseUnits('0.2',18) || await router.savings(owner.address) !== beforeSavings + ethers.parseUnits('0.1',6) || await token.balanceOf(receive) !== 0n) throw new Error('Worker financial output mismatch');
    evidence.transactions.push({ label: 'Distinct worker confirmed incoming split', hash: confirmed.hash, block: receipt.blockNumber });
    evidence.split = { inputUSDG: '1', spendableUSDG: '0.7', savingsUSDG: '0.1', demoOwn: '0.2' };
    evidence.status = 'completed';
  } finally {
    await tx('Revoke temporary worker and restore vesting schedule', router.setVestingSeconds(originalVesting));
    evidence.finishedAt = new Date().toISOString(); save();
  }
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
