const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const { verify, USDG } = require('./verify-robinhood');
async function main() {
  await verify();
  const manifestPath = path.join(__dirname, '../deployments/robinhood-testnet.json');
  if (!fs.existsSync(manifestPath)) throw new Error('BLOCKED: Robinhood OwnRules deployment manifest not present.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const [owner] = await ethers.getSigners();
  const router = await ethers.getContractAt('OwnRules', manifest.ownRules);
  if ((await router.policyAdmin()).toLowerCase() !== owner.address.toLowerCase()) throw new Error('Demo needs the deployment test-policy administrator.');
  const token = new ethers.Contract(USDG, ['function balanceOf(address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function transfer(address,uint256) returns(bool)'], owner);
  if (await token.balanceOf(owner.address) < 100000000n) throw new Error('BLOCKED: demo needs 100 official TESTNET USDG (6 decimals).');
  const evidence = { status: 'in-progress', chainId: 46630, owner: owner.address, accountRoles: 'Deployer doubles as payer, recipient and test agent; no sponsorship claimed.', executedAt: new Date().toISOString(), transactions: [], negativeChecks: [] };
  const evidencePath = path.join(__dirname, '../../docs/evidence/robinhood-demo.json');
  const persist = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  async function tx(label, transaction) { const sent = await transaction; const r = await sent.wait(); if (r.status !== 1) throw new Error(`${label} reverted`); evidence.transactions.push({ label, hash: r.hash, block: r.blockNumber, explorer: `https://explorer.testnet.chain.robinhood.com/tx/${r.hash}` }); persist(); }
  const expiry = Math.floor(Date.now()/1000) + 86400;
  await tx('Explicit local test-policy eligibility', router.setCompliance(owner.address, expiry, false));
  if (await router.accounts(owner.address) === ethers.ZeroAddress) await tx('Create purpose-limited receive smart account', router.createAccount());
  await tx('OwnRule 70/10/20 with USDG ownership reserve', router.saveRule(1000, 2000, 100000000, 500000000, ethers.ZeroAddress, 0, true));
  await tx('Reset previous demo vesting schedule', router.setVestingSeconds(0));
  await tx('Exact 100 test USDG approval', token.approve(manifest.ownRules, 100000000));
  const savedBefore = await router.savings(owner.address), reserveBefore = await router.ownershipReserve(owner.address), cashBefore = await token.balanceOf(owner.address);
  await tx('100 USDG actual split', router.pay(owner.address, 100000000, ethers.keccak256(ethers.randomBytes(32))));
  if (await router.savings(owner.address) !== savedBefore + 10000000n || await router.ownershipReserve(owner.address) !== reserveBefore + 20000000n) throw new Error('Split accounting mismatch');
  if (await token.balanceOf(owner.address) !== cashBefore - 30000000n) throw new Error('Actual spendable USDG mismatch');
  evidence.split = { inputRaw: '100000000', actualSpendableRaw: '70000000', savingsRaw: '10000000', ownershipReserveRaw: '20000000' };
  await tx('Withdraw 10 USDG savings', router.withdraw(false, 10000000));
  await tx('Withdraw 20 USDG reserve', router.withdraw(true, 20000000));
  await tx('Select no-value DEMO-OWN adapter', router.saveRule(1000, 2000, 100000000, 500000000, manifest.demoAdapter, 10n ** 18n, true));
  await tx('Deposit 100 test USDG to receive account', token.transfer(await router.accounts(owner.address), 100000000));
  await tx('Constrained delegate (demo deployer doubles as test agent)', router.delegate(owner.address, expiry));
  const asset = await ethers.getContractAt('DemoOwnershipUnits', manifest.demoAsset); const beforeAsset = await asset.balanceOf(owner.address);
  await tx('Process income into 70 USDG cash, 10 savings, 20 DEMO-OWN', router.processIncoming(owner.address, 100000000, ethers.ZeroHash));
  if (await asset.balanceOf(owner.address) !== beforeAsset + 20n * 10n ** 18n) throw new Error('DEMO-OWN output mismatch');
  await tx('Recover savings for vesting demo', router.withdraw(false, 10000000));
  await tx('Set two-second test vesting schedule (revokes delegation)', router.setVestingSeconds(2));
  await tx('Authorize exact new rule version', router.delegate(owner.address, expiry));
  await tx('Deposit 20 test USDG for vested ownership', token.transfer(await router.accounts(owner.address), 20000000));
  const vesting = await ethers.getContractAt('OwnAssetVesting', manifest.vesting);
  const grantIndex = await vesting.grantCount(owner.address);
  await tx('Process income into funded ownership vesting', router.processIncoming(owner.address, 20000000, ethers.ZeroHash));
  const grantId = await vesting.grantId(owner.address, grantIndex);
  const grant = await vesting.grants(grantId);
  if (grant.total !== 4n * 10n ** 18n) throw new Error('Funded vesting amount mismatch');
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await vesting.claimable(grantId) === grant.total) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (await vesting.claimable(grantId) !== grant.total) throw new Error('Test vesting did not mature within 30 seconds');
  const beforeClaim = await asset.balanceOf(owner.address);
  await tx('Claim matured DEMO-OWN to named recipient', vesting.claim(grantId));
  if (await asset.balanceOf(owner.address) !== beforeClaim + grant.total) throw new Error('Claim recipient balance mismatch');
  evidence.vesting = { grantId: String(grantId), totalRaw: String(grant.total), start: String(grant.start), durationSeconds: String(grant.duration), fullyClaimed: true };
  await tx('Revoke constrained test delegation', router.delegate(ethers.ZeroAddress, 0));
  await tx('Block recipient in test compliance policy', router.setCompliance(owner.address, expiry, true));
  try { await router.pay.staticCall(owner.address, 1, ethers.ZeroHash); throw new Error('Denied payment unexpectedly passed'); }
  catch(e) { if (!e.message.includes('compliance denied')) throw e; evidence.negativeChecks.push('Blocked recipient rejected by eth_call: compliance denied'); }
  await tx('Restore explicit test eligibility', router.setCompliance(owner.address, expiry, false));
  evidence.finalBalances = { savingsRaw: String(await router.savings(owner.address)), reserveRaw: String(await router.ownershipReserve(owner.address)), demoAssetRaw: String(await asset.balanceOf(owner.address)) };
  evidence.status = 'completed-wallet-paid-demo'; persist();
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
