import type { Address } from "viem";

/**
 * Verified Base market assets used by the OwnPay Global Markets rail.
 *
 * These are intentionally separate from the Coinbase B20 registry: DPRI is
 * an external GetEquity ERC-20 market asset and is settled with cNGN.
 */
export type SupportedMarketAsset = {
  symbol: "DPRI";
  name: string;
  address: Address;
  payoutToken: Address;
  decimals: number;
  chainId: 8453;
  venue: "getequity";
  marketUrl: string;
};

export const BASE_CNGN_ADDRESS =
  "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F" as Address;

export const DPRI_ADDRESS =
  "0xc68b460fe4c916Fd17d6ab6b181A409C763002d9" as Address;

export const DPRI_MARKET_URL =
  "https://www.getequity.io/onchain-swap/?slug=6aa7bb4317b2b000025c539b&network=base";

export const SUPPORTED_MARKET_ASSETS: readonly SupportedMarketAsset[] = [
  {
    symbol: "DPRI",
    name: "Dangote Petroleum Refinery IPO",
    address: DPRI_ADDRESS,
    payoutToken: BASE_CNGN_ADDRESS,
    decimals: 18,
    chainId: 8453,
    venue: "getequity",
    marketUrl: DPRI_MARKET_URL,
  },
];

export function marketAssetBySymbol(symbol: string): SupportedMarketAsset | undefined {
  return SUPPORTED_MARKET_ASSETS.find((asset) => asset.symbol === symbol);
}

export function marketAssetByAddress(address: string): SupportedMarketAsset | undefined {
  return SUPPORTED_MARKET_ASSETS.find((asset) => asset.address.toLowerCase() === address.toLowerCase());
}

