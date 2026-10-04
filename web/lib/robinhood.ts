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
  'function rules(address) view returns(uint16 savingsBps,uint16 ownershipBps,uint128 maxPayment,uint128 dailyLimit,uint64 version,bool enabled)',
  'function portfolioOf(address) view returns((address asset,uint16 weightBps)[])',
  'function buyPending(address owner,uint256 amount)',
  'event OwnershipQueued(address indexed owner,uint256 usdgAmount)',
  'event OwnershipBought(address indexed owner,address indexed asset,uint256 usdgIn,uint256 rawOut)',
  'function delegations(address) view returns(address agent,uint64 expires,uint64 ruleVersion)',
  // Recipient-programmed compliance (no admin): sender status 0 unset, 1 allowed, 2 blocked.
  'function policies(address) view returns(bool allowlistOnly,bool requireMemo,uint128 perSenderDailyCap)',
  'function senderStatus(address owner,address sender) view returns(uint8)',
  'function setPolicy(bool allowlistOnly,bool requireMemo,uint128 perSenderDailyCap)',
  'function setSender(address sender,uint8 status)',
  'event PolicySaved(address indexed owner,bool allowlistOnly,bool requireMemo,uint128 perSenderDailyCap)',
  'event SenderStatusChanged(address indexed owner,address indexed sender,uint8 status)',
  'event AccountCreated(address indexed owner,address indexed account)',
  'event RuleSaved(address indexed owner,uint64 version,uint16 savingsBps,uint16 ownershipBps,address[] assets,uint16[] weightsBps)',
  'event AgentChanged(address indexed owner,address agent,uint64 expires,uint64 version)',
  'event Withdrawal(address indexed owner,bool ownership,uint256 amount)',
  'function executeSigned(address owner,uint8 action,bytes data,uint256 deadline,bytes signature)',
  'function createAccount() returns(address)',
  'function saveRule(uint16 saved,uint16 owned,uint128 maxPayment,uint128 dailyLimit,address[] assets,uint16[] weightsBps,bool enabled)',
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

export const stockDeskAbi = parseAbi([
  'function prices(address) view returns(uint128 usdPerShare,uint64 quoteTime)',
  'function isFresh(address) view returns(bool)',
  'function maxAge() view returns(uint64)',
  'function spreadBps() view returns(uint16)',
]);
