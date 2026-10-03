import 'server-only';
import { createPublicClient, http, isAddress, type Address } from 'viem';
import { ownRulesAbi, robinhoodTestnet, TEST_USDG } from './robinhood';

export const rhPublic = createPublicClient({ chain: robinhoodTestnet, transport: http(process.env.ROBINHOOD_TESTNET_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 1 }) });
export function rhConfig() {
  const value = process.env.ROBINHOOD_OWNRULES_ADDRESS;
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error('Robinhood testnet contracts are not deployed/configured yet.');
  return { router: value as Address, demoAdapter: process.env.ROBINHOOD_DEMO_ADAPTER_ADDRESS || null, demoAsset: process.env.ROBINHOOD_DEMO_ASSET_ADDRESS || null, startBlock: BigInt(process.env.ROBINHOOD_DEPLOYMENT_BLOCK || '0') };
}
export async function verifyRhDeployment() {
  const config = rhConfig();
  if (await rhPublic.getChainId() !== 46630 || !await rhPublic.getCode({ address: config.router })) throw new Error('Robinhood deployment verification failed.');
  const token = await rhPublic.readContract({ address: config.router, abi: ownRulesAbi, functionName: 'usdg' });
  if (token.toLowerCase() !== TEST_USDG.toLowerCase()) throw new Error('Router is not configured with official testnet USDG.');
  return config;
}
