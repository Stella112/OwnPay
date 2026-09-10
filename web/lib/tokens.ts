import type { Address } from "viem";
import { isAddress } from "viem";

/**
 * Official Coinbase B20 tokenized-stock allowlist (spec C13, user-protection).
 *
 * OwnPay only operates on tokens in this allowlist. The default addresses below
 * were VERIFIED directly against Base mainnet (chainId 8453) on 2026-09-09 —
 * each responds with the expected symbol/name, decimals = 8, and the real B20
 * surface (toScaledBalance/toRawBalance/multiplier). Source of truth:
 * https://www.base.org/stocks (cross-checked by on-chain reads, not just the page).
 *
 * In dev-only local mode, an environment variable overrides the default for a
 * token — used to point the app at a locally-deployed MockB20 during testing:
 *   web/.env.local
 *     NEXT_PUBLIC_AAPLC_ADDRESS=0x...   NEXT_PUBLIC_NVDAC_ADDRESS=0x...
 *
 * Production ignores these overrides and always uses the verified addresses.
 * Any selected address that is invalid is omitted, so the app never transacts
 * against malformed configuration.
 */
export type SupportedToken = {
  symbol: string;
  name: string;
  address: Address;
};

type TokenSeed = { symbol: string; name: string; env: string | undefined; verified: string };

const SEEDS: TokenSeed[] = [
  {
    symbol: "AAPLc",
    name: "Apple",
    env: process.env.NEXT_PUBLIC_AAPLC_ADDRESS,
    verified: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  },
  {
    symbol: "NVDAc",
    name: "NVIDIA",
    env: process.env.NEXT_PUBLIC_NVDAC_ADDRESS,
    verified: "0xb20000000000000000000078ee7ce2fE4908108C",
  },
  {
    symbol: "METAc",
    name: "Meta",
    env: process.env.NEXT_PUBLIC_METAC_ADDRESS,
    verified: "0xb2000000000000000000008bC8786B856E61707C",
  },
  {
    symbol: "GOOGLc",
    name: "Alphabet",
    env: process.env.NEXT_PUBLIC_GOOGLC_ADDRESS,
    verified: "0xb2000000000000000000002D0BA3164cc74f58B7",
  },
  {
    symbol: "AMZNc",
    name: "Amazon",
    env: process.env.NEXT_PUBLIC_AMZNC_ADDRESS,
    verified: "0xb200000000000000000000d9192b6B456483C2E8",
  },
  {
    symbol: "MSFTc",
    name: "Microsoft",
    env: process.env.NEXT_PUBLIC_MSFTC_ADDRESS,
    verified: "0xB200000000000000000000Ab99cFa739E253872B",
  },
  {
    symbol: "MSTRc",
    name: "Strategy",
    env: process.env.NEXT_PUBLIC_MSTRC_ADDRESS,
    verified: "0xb2000000000000000000004884b426556b92883d",
  },
  {
    symbol: "SNDKc",
    name: "SanDisk",
    env: process.env.NEXT_PUBLIC_SNDKC_ADDRESS,
    verified: "0xb200000000000000000000397293Cb8cda9a10c5",
  },
  {
    symbol: "SPCXc",
    name: "SpaceX",
    env: process.env.NEXT_PUBLIC_SPCXC_ADDRESS,
    verified: "0xb2000000000000000000007b9fcbd005511aCBd5",
  },
  {
    symbol: "TSLAc",
    name: "Tesla",
    env: process.env.NEXT_PUBLIC_TSLAC_ADDRESS,
    verified: "0xb2000000000000000000001e800a7f5189430cD0",
  },
];

const LOCAL = process.env.NEXT_PUBLIC_ENABLE_LOCAL === "true";

export const SUPPORTED_TOKENS: SupportedToken[] = SEEDS.flatMap((s) => {
  const chosen = LOCAL && s.env && s.env.length > 0 ? s.env : s.verified;
  return isAddress(chosen) ? [{ symbol: s.symbol, name: s.name, address: chosen as Address }] : [];
});

export function isAllowlisted(address: string): boolean {
  const a = address.toLowerCase();
  return SUPPORTED_TOKENS.some((t) => t.address.toLowerCase() === a);
}

export function tokenByAddress(address: string): SupportedToken | undefined {
  const a = address.toLowerCase();
  return SUPPORTED_TOKENS.find((t) => t.address.toLowerCase() === a);
}

export function tokenBySymbol(symbol: string): SupportedToken | undefined {
  return SUPPORTED_TOKENS.find((t) => t.symbol === symbol);
}

/** True when at least one official token address has been configured. */
export function hasConfiguredTokens(): boolean {
  return SUPPORTED_TOKENS.length > 0;
}
