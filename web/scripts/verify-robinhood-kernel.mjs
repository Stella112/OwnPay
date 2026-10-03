import fs from 'node:fs/promises';
import { createKernelAccount } from '@zerodev/sdk';
import { KERNEL_V3_1, getEntryPoint } from '@zerodev/sdk/constants';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createPublicClient, defineChain, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } } });
const client = createPublicClient({ chain, transport: http() });
const report = { checkedAt: new Date().toISOString(), chainId: await client.getChainId(), sdk: '5.5.10', validatorPackage: '5.4.9', contracts: {}, sponsorship: 'BLOCKED: no ZeroDev project endpoint or gas policy configured' };
if (report.chainId !== 46630) throw new Error('Wrong network');
const entryPoint = getEntryPoint('0.7');
// Public test-only signer used ONLY to derive a counterfactual account; no funds,
// signatures or transactions are sent. This key is not a secret or deployed owner.
const signer = privateKeyToAccount(`0x${'0'.repeat(63)}1`);
async function check(label, address) {
  const code = await client.getCode({ address });
  report.contracts[label] = { address, hasCode: !!code && code !== '0x', bytecodeHash: code ? keccak256(code) : null };
  if (!code || code === '0x') throw new Error(`${label} has no code on testnet`);
}
try {
  await check('entryPoint07', entryPoint.address);
  const validator = await signerToEcdsaValidator(client, { signer, entryPoint, kernelVersion: KERNEL_V3_1 });
  await check('ecdsaValidator', validator.address);
  const account = await createKernelAccount(client, { plugins: { sudo: validator }, entryPoint, kernelVersion: KERNEL_V3_1 });
  const factory = await account.getFactoryArgs();
  if (factory.factory) await check('kernelFactory', factory.factory);
  report.counterfactualTestAccount = account.address;
  report.result = 'SDK account derivation and required bytecode verified; sponsored user operation NOT executed';
} catch(e) { report.result = `BLOCKED: ${e.shortMessage || e.message}`; process.exitCode = 1; }
await fs.mkdir('../docs/evidence', { recursive: true });
await fs.writeFile('../docs/evidence/robinhood-kernel.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
