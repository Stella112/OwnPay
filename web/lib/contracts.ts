import type { Abi, Address } from "viem";
import { isAddress } from "viem";
import stockVestingJson from "./abi/StockVesting.json";

export const stockVestingAbi = stockVestingJson as Abi;

/**
 * Deployed StockVesting escrow address on Base. Set after deploying:
 *   web/.env.local -> NEXT_PUBLIC_STOCK_VESTING_ADDRESS=0x...
 *
 * Empty until deployed. The UI must guard on `isVestingConfigured()` and never
 * pretend a grant/claim happened against a missing contract.
 */
const rawVestingAddress = process.env.NEXT_PUBLIC_STOCK_VESTING_ADDRESS ?? "";

export const STOCK_VESTING_ADDRESS: Address | undefined = isAddress(rawVestingAddress)
  ? (rawVestingAddress as Address)
  : undefined;

export function isVestingConfigured(): boolean {
  return STOCK_VESTING_ADDRESS !== undefined;
}

/** Minimal ERC-20 ABI used for balance/allowance/approve in the flows. */
export const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transferWithMemo", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "memo", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
