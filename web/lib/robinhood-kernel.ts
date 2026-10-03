'use client';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { KERNEL_V3_1, getEntryPoint } from '@zerodev/sdk/constants';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createPublicClient, createWalletClient, custom, http, type WalletClient } from 'viem';
import { robinhoodTestnet } from './robinhood';

// Uses the documented SDK APIs, not an invented bundler endpoint. The project
// URL is supplied by the owner's configured ZeroDev testnet project.
export async function createRobinhoodKernel(signer: WalletClient) {
  if (!signer.account) throw new Error('A connected signer is required.');
  const endpoint = process.env.NEXT_PUBLIC_ROBINHOOD_ZERODEV_RPC;
  if (!endpoint || new URL(endpoint).protocol !== 'https:') throw new Error('Configure a ZeroDev project on chain 46630 with an approved sponsorship policy.');
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http() });
  if (await client.getChainId() !== 46630) throw new Error('Wrong testnet RPC.');
  const entryPoint = getEntryPoint('0.7');
  if (!await client.getCode({ address: entryPoint.address })) throw new Error('EntryPoint 0.7 not deployed on this testnet.');
  const kernelSigner = createWalletClient({ account: signer.account, chain: robinhoodTestnet, transport: custom(signer.transport) });
  const validator = await signerToEcdsaValidator(client, { signer: kernelSigner, entryPoint, kernelVersion: KERNEL_V3_1 });
  if (!await client.getCode({ address: validator.address })) throw new Error('SDK validator not deployed on this testnet.');
  const account = await createKernelAccount(client, { plugins: { sudo: validator }, entryPoint, kernelVersion: KERNEL_V3_1 });
  const factory = await account.getFactoryArgs();
  if (factory.factory && !await client.getCode({ address: factory.factory })) throw new Error('SDK factory not deployed on this testnet.');
  const paymaster = createZeroDevPaymasterClient({ chain: robinhoodTestnet, transport: http(endpoint) });
  const kernel = createKernelAccountClient({ account, chain: robinhoodTestnet, client, bundlerTransport: http(endpoint),
    paymaster: { getPaymasterData: userOperation => paymaster.sponsorUserOperation({ userOperation }) },
  });
  // Wrong provider chain fails closed before creating any user operation.
  const providerChain = await kernel.request({ method: 'eth_chainId' });
  if (BigInt(providerChain) !== 46630n) throw new Error('ZeroDev project is not Robinhood Chain Testnet.');
  return kernel;
}
