import { parseAbi, type Address } from 'viem';

/**
 * Robinhood Chain Testnet (46630) stock-token escrow + faucet-issued test stock
 * tokens. Addresses verified over RPC (docs/VERIFIED_EXTERNALS.md) and mirrored in
 * contracts/deployments/robinhood-stock-vesting.json. No monetary value.
 */
export const RH_STOCK_VESTING: Address = '0x34f750Bd9B07a5C12447e4ebbEA9dA5Be032a917';
export const RH_STOCK_VESTING_FROM_BLOCK = 128368312n;

export const RH_STOCKS = [
  { symbol: 'TSLA', name: 'Tesla', address: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E' },
  { symbol: 'AMD', name: 'AMD', address: '0x71178BAc73cBeb415514eB542a8995b82669778d' },
  { symbol: 'AMZN', name: 'Amazon', address: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02' },
  { symbol: 'NFLX', name: 'Netflix', address: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93' },
  { symbol: 'PLTR', name: 'Palantir', address: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0' },
] as const satisfies readonly { symbol: string; name: string; address: Address }[];

export const rhStockBySymbol = (s: string) => RH_STOCKS.find((t) => t.symbol === s);
export const rhStockByAddress = (a: string) => RH_STOCKS.find((t) => t.address.toLowerCase() === a.toLowerCase());

/** These tokens expose uiMultiplier() (ERC-8056-style), not Base B20's toScaledBalance. */
export const rhStockTokenAbi = parseAbi([
  'function uiMultiplier() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);

export const rhStockVestingAbi = parseAbi([
  'function createGrant(address token, address to, uint256 total, uint64 start, uint64 cliff, uint64 duration, bool revocable, bytes32 memo) returns (uint256)',
  'function release(uint256 id) returns (uint256)',
  'function revoke(uint256 id)',
  'function tipWithMemo(address token, address to, uint256 amount, bytes32 memo)',
  'function grants(uint256) view returns (address token, address from, address to, uint256 total, uint256 released, uint64 start, uint64 cliff, uint64 duration, bool revocable, bool revoked, bytes32 memo)',
  'function vestedRaw(uint256 id) view returns (uint256)',
  'function releasableRaw(uint256 id) view returns (uint256)',
  'event GrantCreated(uint256 indexed id, address indexed token, address indexed to, address from, uint256 total, uint64 start, uint64 cliff, uint64 duration, bool revocable, bytes32 memo)',
]);

const ONE = 10n ** 18n;
/** Raw token units -> displayed share units, applying the token's uiMultiplier (1e18 = 1.0x). */
export const rawToShares = (raw: bigint, uiMultiplier: bigint) => (raw * uiMultiplier) / ONE;
/** Displayed share units -> raw token units (inverse of rawToShares). */
export const sharesToRaw = (shares: bigint, uiMultiplier: bigint) => (shares * ONE) / uiMultiplier;
