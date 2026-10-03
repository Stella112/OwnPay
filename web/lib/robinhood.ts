import { defineChain, parseAbi } from 'viem';

export const robinhoodTestnet = defineChain({
  id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Testnet Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});
export const TEST_USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F' as const;
export const ownRulesAbi = parseAbi([
  'function accounts(address) view returns(address)',
  'function savings(address) view returns(uint256)',
  'function ownershipReserve(address) view returns(uint256)',
  'function nonces(address) view returns(uint256)',
  'function usdg() view returns(address)',
  'function vesting() view returns(address)',
  'function vestingSeconds(address) view returns(uint64)',
  'function rules(address) view returns(uint16 savingsBps,uint16 ownershipBps,uint128 maxPayment,uint128 dailyLimit,address adapter,uint128 minAssetPerUsdg,uint64 version,bool enabled)',
  'function delegations(address) view returns(address agent,uint64 expires,uint64 ruleVersion)',
  'function compliance(address) view returns(uint64 expires,bool blocked)',
  'function executeSigned(address owner,uint8 action,bytes data,uint256 deadline,bytes signature)',
  'function createAccount() returns(address)',
  'function saveRule(uint16 saved,uint16 owned,uint128 maxPayment,uint128 dailyLimit,address adapter,uint128 minRate,bool enabled)',
  'function setVestingSeconds(uint64 seconds_)',
  'function delegate(address agent,uint64 expires)',
  'function processIncoming(address owner,uint256 amount,bytes32 metadataCommitment)',
  'function withdraw(bool ownership,uint256 amount)',
  'function pay(address owner,uint256 amount,bytes32 metadataCommitment)',
  'event PaymentReceipt(uint256 indexed id,address indexed owner,address indexed payer,uint256 amount,uint256 spendable,uint256 saved,uint256 ownership,uint256 assetOut,uint64 ruleVersion,bytes32 metadataCommitment)',
]);
export const intentTypes = { Intent: [
  { name: 'owner', type: 'address' }, { name: 'action', type: 'uint8' }, { name: 'dataHash', type: 'bytes32' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] } as const;
export function intentDomain(router: `0x${string}`) {
  return { name: 'OwnPay OwnRules', version: '1', chainId: 46630, verifyingContract: router } as const;
}
