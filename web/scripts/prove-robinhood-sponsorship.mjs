// Proves ZeroDev gas sponsorship on Robinhood Chain Testnet (46630) with a REAL
// user operation. A brand-new, never-funded signer (0 ETH) uses a Kernel smart
// account to batch two real OwnRules calls: createAccount + saveRule(70/10/20).
// Success is only reported from a confirmed onchain receipt plus state reads.
//
//   ROBINHOOD_ZERODEV_RPC=https://rpc.zerodev.app/api/v3/<project>/chain/46630 \
//     node scripts/prove-robinhood-sponsorship.mjs
//
// The ephemeral key lives only in memory for this run and is never written out.
import fs from 'node:fs/promises';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { KERNEL_V3_1, getEntryPoint } from '@zerodev/sdk/constants';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createPublicClient, defineChain, encodeFunctionData, http, parseAbi, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const endpoint = process.env.ROBINHOOD_ZERODEV_RPC;
if (!endpoint || !endpoint.startsWith('https://')) throw new Error('Set ROBINHOOD_ZERODEV_RPC to the ZeroDev project RPC for chain 46630.');

const manifest = JSON.parse(await fs.readFile(new URL('../../contracts/deployments/robinhood-testnet.json', import.meta.url), 'utf8'));
const router = manifest.ownRules;
const chain = defineChain({
  id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
});
const explorer = chain.blockExplorers.default.url;
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 30_000 }) });
if (await client.getChainId() !== 46630) throw new Error('Wrong chain');

const abi = parseAbi([
  'function createAccount() returns (address)',
  'function saveRule(uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit, address adapter, uint128 minRate, bool enabled)',
  'function accounts(address) view returns (address)',
]);

const signer = privateKeyToAccount(generatePrivateKey()); // fresh, never funded
const entryPoint = getEntryPoint('0.7');
const validator = await signerToEcdsaValidator(client, { signer, entryPoint, kernelVersion: KERNEL_V3_1 });
const account = await createKernelAccount(client, { plugins: { sudo: validator }, entryPoint, kernelVersion: KERNEL_V3_1 });
const paymaster = createZeroDevPaymasterClient({ chain, transport: http(endpoint) });
const kernel = createKernelAccountClient({
  account, chain, client, bundlerTransport: http(endpoint),
  paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
});

const before = { signerEth: await client.getBalance({ address: signer.address }), accountEth: await client.getBalance({ address: account.address }) };
if (before.signerEth !== 0n || before.accountEth !== 0n) throw new Error('Expected a never-funded signer/account.');
console.log(`signer  ${signer.address} (0 ETH)\naccount ${account.address} (0 ETH, counterfactual)`);

const usdg = (n) => BigInt(n) * 1_000_000n; // USDG has 6 decimals (verified)
const calls = [
  { to: router, value: 0n, data: encodeFunctionData({ abi, functionName: 'createAccount' }) },
  // 10% savings, 20% ownership (70% spendable), max 100 USDG/payment, 500 USDG/day, no adapter.
  { to: router, value: 0n, data: encodeFunctionData({ abi, functionName: 'saveRule', args: [1000, 2000, usdg(100), usdg(500), zeroAddress, 0n, true] }) },
];

const report = { checkedAt: new Date().toISOString(), chainId: 46630, router, signer: signer.address, kernelAccount: account.address, entryPoint: entryPoint.address, before: { signerEth: '0', accountEth: '0' } };
try {
  const userOpHash = await kernel.sendUserOperation({ callData: await account.encodeCalls(calls) });
  console.log('userOp', userOpHash);
  const rec = await kernel.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 });
  // Read state AT the inclusion block: a load-balanced RPC can otherwise serve a
  // node that has not seen the block yet and report stale (empty) state.
  const at = { blockNumber: rec.receipt.blockNumber };
  const receiveAccount = await client.readContract({ address: router, abi, functionName: 'accounts', args: [account.address], ...at });
  const after = { signerEth: await client.getBalance({ address: signer.address, ...at }), accountEth: await client.getBalance({ address: account.address, ...at }) };
  const paymasterUsed = rec.paymaster && rec.paymaster !== zeroAddress ? rec.paymaster : null;
  // ZeroDev may sponsor either via an onchain paymaster (paymaster != 0) or by
  // submitting a zero-fee user operation whose gas the bundler covers
  // (paymaster == 0, actualGasCost == 0). Either way the user pays nothing; we
  // record which mechanism was used rather than assuming one.
  const mechanism = paymasterUsed ? 'onchain paymaster' : rec.actualGasCost === 0n ? 'zero-fee user operation; bundler paid transaction gas' : 'NONE (account paid its own gas)';
  Object.assign(report, {
    userOpHash, success: rec.success, txHash: rec.receipt.transactionHash, block: String(rec.receipt.blockNumber),
    bundler: rec.receipt.from, transactionGasUsed: String(rec.receipt.gasUsed),
    sponsorshipMechanism: mechanism, paymaster: paymasterUsed, actualGasCostWei: String(rec.actualGasCost),
    receiveAccount, after: { signerEth: String(after.signerEth), accountEth: String(after.accountEth) },
    explorerTx: `${explorer}/tx/${rec.receipt.transactionHash}`,
  });
  const sponsored = !!paymasterUsed || rec.actualGasCost === 0n;
  const ok = rec.success && sponsored && receiveAccount !== zeroAddress && after.signerEth === 0n && after.accountEth === 0n;
  report.result = ok
    ? `VERIFIED: sponsored user operation (${mechanism}) succeeded; never-funded account paid 0 ETH; OwnRules receive account created and 70/10/20 rule saved in one batch.`
    : 'NOT VERIFIED: see fields (success/sponsorshipMechanism/receiveAccount/balances).';
  if (!ok) process.exitCode = 1;
} catch (e) {
  report.result = `FAILED: ${e.shortMessage || e.message}`;
  report.details = String(e.details || e.cause?.message || '').slice(0, 600);
  process.exitCode = 1;
}
await fs.writeFile(new URL('../../docs/evidence/robinhood-sponsorship.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
