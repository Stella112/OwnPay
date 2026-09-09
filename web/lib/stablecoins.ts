import type { Address } from "viem";

/**
 * Verified stablecoin registry for Base mainnet.
 *
 * This is deliberately a closed list. Users never provide a token address to
 * a payment flow; adding another rail requires a separately verified entry.
 */
export type SupportedStablecoin = {
  symbol: "USDC";
  name: string;
  address: Address;
  chainId: 8453;
};

export const BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

export const SUPPORTED_STABLECOINS: readonly SupportedStablecoin[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: BASE_USDC_ADDRESS,
    chainId: 8453,
  },
];

export function stablecoinBySymbol(symbol: string): SupportedStablecoin | undefined {
  return SUPPORTED_STABLECOINS.find((asset) => asset.symbol === symbol);
}

export function isSupportedStablecoin(address: string): boolean {
  return SUPPORTED_STABLECOINS.some((asset) => asset.address.toLowerCase() === address.toLowerCase());
}
