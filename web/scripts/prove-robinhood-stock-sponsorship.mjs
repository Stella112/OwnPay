// Proves the ZeroDev contract policies for the stock flows on chain 46630 with REAL
// user operations from a never-funded (0 ETH) Kernel account:
//   op1: approve TSLA + createGrant (Pay)  op2: tipWithMemo  op3: revoke  op4: release
// (each approve policy was also probed individually; see report)
// The deployer (contracts/.env) only transfers 0.02 test TSLA to the new account.
//   ROBINHOOD_ZERODEV_RPC=... node scripts/prove-robinhood-stock-sponsorship.mjs
import fs from 'node:fs/promises';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { KERNEL_V3_1, getEntryPoint } from '@zerodev/sdk/constants';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, parseUnits, zeroAddress, stringToHex, decodeEventLog } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const endpoint = process.env.ROBINHOOD_ZERODEV_RPC;
if (!endpoint?.startsWith('https://')) throw new Error('Set ROBINHOOD_ZERODEV_RPC');
const envText = await fs.readFile(new URL('../../contracts/.env', import.meta.url), 'utf8');
const deployerKey = envText.match(/^DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];
if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY missing in contracts/.env');

const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } } });
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 30_000 }) });
const m = JSON.parse(await fs.readFile(new URL('../../contracts/deployments/robinhood-stock-vesting.json', import.meta.url), 'utf8'));
const USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const VEST = m.stockVesting, TSLA = m.stockTokens.TSLA;
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const vabi = parseAbi([
  'function createGrant(address,address,uint256,uint64,uint64,uint64,bool,bytes32) returns (uint256)',
  'function revoke(uint256)', 'function release(uint256) returns (uint256)', 'function tipWithMemo(address,address,uint256,bytes32)',
  'event GrantCreated(uint256 indexed id, address indexed token, address indexed to, address from, uint256 total, uint64 start, uint64 cliff, uint64 duration, bool revocable, bytes32 memo)',
]);

const signer = privateKeyToAccount(generatePrivateKey());
const entryPoint = getEntryPoint('0.7');
const validator = await signerToEcdsaValidator(client, { signer, entryPoint, kernelVersion: KERNEL_V3_1 });
const account = await createKernelAccount(client, { plugins: { sudo: validator }, entryPoint, kernelVersion: KERNEL_V3_1 });
const pm = createZeroDevPaymasterClient({ chain, transport: http(endpoint) });
const kernel = createKernelAccountClient({ account, chain, client, bundlerTransport: http(endpoint), paymaster: { getPaymasterData: (userOperation) => pm.sponsorUserOperation({ userOperation }) } });
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const report = { chainId: 46630, kernelAccount: account.address, recipient, ops: [] };

// Fund the new account with test stock only (no ETH).
const deployer = createWalletClient({ account: privateKeyToAccount(deployerKey), chain, transport: http() });
const fundAmt = parseUnits('0.02', 18), grantAmt = parseUnits('0.01', 18);
const fundTx = await deployer.writeContract({ address: TSLA, abi: erc20, functionName: 'transfer', args: [account.address, fundAmt] });
await client.waitForTransactionReceipt({ hash: fundTx });
report.funding = { tx: fundTx, tsla: '0.02', eth: '0' };

async function op(label, calls) {
  try {
    const h = await kernel.sendUserOperation({ callData: await account.encodeCalls(calls) });
    const r = await kernel.waitForUserOperationReceipt({ hash: h, timeout: 120_000 });
    const entry = { label, ok: r.success && r.actualGasCost === 0n, success: r.success, actualGasCostWei: String(r.actualGasCost), tx: r.receipt.transactionHash, explorer: `${EXPLORER}/tx/${r.receipt.transactionHash}` };
    report.ops.push(entry); console.log(entry.ok ? '✓' : '✗', label, entry.tx); return r;
  } catch (e) {
    report.ops.push({ label, ok: false, error: (e.details || e.shortMessage || e.message || '').toString().slice(0, 300) });
    console.log('✗', label, (e.details || e.shortMessage || '').toString().slice(0, 200)); return null;
  }
}

const now = Number((await client.getBlock()).timestamp);
const approve = (t, amt) => ({ to: t, value: 0n, data: encodeFunctionData({ abi: erc20, functionName: 'approve', args: [VEST, amt] }) });
// Exactly the UI's call shapes: approve + action (Pay), then a lone action (Tip; allowance already set).
const r1 = await op('approve TSLA + createGrant (Pay)', [
  approve(TSLA, fundAmt),
  { to: VEST, value: 0n, data: encodeFunctionData({ abi: vabi, functionName: 'createGrant', args: [TSLA, recipient, grantAmt, BigInt(now), BigInt(now), 600n, true, stringToHex('sponsored pay', { size: 32 })] }) },
]);
await op('tipWithMemo (Tip)', [{ to: VEST, value: 0n, data: encodeFunctionData({ abi: vabi, functionName: 'tipWithMemo', args: [TSLA, recipient, grantAmt, stringToHex('sponsored tip', { size: 32 })] }) }]);
let id;
for (const l of r1?.logs ?? []) { try { const d = decodeEventLog({ abi: vabi, data: l.data, topics: l.topics }); if (d.eventName === 'GrantCreated') id = d.args.id; } catch {} }
if (id !== undefined) {
  report.grantId = String(id);
  const start = Date.now(); while (Date.now() - start < 20_000) await new Promise((r) => setTimeout(r, 2000)); // let some vest
  await op('revoke', [{ to: VEST, value: 0n, data: encodeFunctionData({ abi: vabi, functionName: 'revoke', args: [id] }) }]);
  await op('release', [{ to: VEST, value: 0n, data: encodeFunctionData({ abi: vabi, functionName: 'release', args: [id] }) }]);
}
report.accountEthAfter = String(await client.getBalance({ address: account.address }));
report.recipientTsla = String(await client.readContract({ address: TSLA, abi: erc20, functionName: 'balanceOf', args: [recipient] }));
report.allPassed = report.ops.length === 4 && report.ops.every((o) => o.ok) && report.accountEthAfter === '0';
report.checkedAt = new Date().toISOString();
await fs.writeFile(new URL('../../docs/evidence/robinhood-stock-sponsorship.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ allPassed: report.allPassed, accountEthAfter: report.accountEthAfter, recipientTsla: report.recipientTsla }, null, 2));
if (!report.allPassed) process.exitCode = 1;
