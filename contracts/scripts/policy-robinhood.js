// Explicit, expiry-limited LOCAL TEST policy. Not KYC or sanctions screening.
const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const { verify, USDG } = require('./verify-robinhood');
async function main() {
  await verify();
  const account = process.env.ROBINHOOD_TEST_POLICY_OWNER;
  const decision = process.env.ROBINHOOD_TEST_POLICY_DECISION;
  if (!account || !ethers.isAddress(account) || account === ethers.ZeroAddress || !['allow', 'block'].includes(decision)) throw new Error('Specify ROBINHOOD_TEST_POLICY_OWNER and explicit DECISION=allow|block.');
  const hours = Number(process.env.ROBINHOOD_TEST_POLICY_HOURS || '1');
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error('Test eligibility duration must be 1..24 hours');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/robinhood-testnet.json')));
  if (manifest.chainId !== 46630) throw new Error('Wrong manifest chain');
  const [admin] = await ethers.getSigners();
  const router = await ethers.getContractAt('OwnRules', manifest.ownRules);
  if ((await router.policyAdmin()).toLowerCase() !== admin.address.toLowerCase() || (await router.usdg()).toLowerCase() !== USDG.toLowerCase()) throw new Error('Policy administrator/token verification failed');
  const block = await ethers.provider.getBlock('latest');
  const expires = block.timestamp + hours * 3600;
  const receipt = await (await router.setCompliance(account, expires, decision === 'block')).wait();
  if (receipt.status !== 1) throw new Error('Policy update reverted');
  const result = await router.compliance(account);
  if (result.blocked !== (decision === 'block') || result.expires !== BigInt(expires)) throw new Error('Policy readback mismatch');
  console.log(JSON.stringify({ chainId: 46630, policy: 'LOCAL TEST ONLY', account, decision, expires, hash: receipt.hash, explorer: `https://explorer.testnet.chain.robinhood.com/tx/${receipt.hash}` }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
