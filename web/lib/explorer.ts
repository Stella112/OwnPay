/** Basescan URL helpers for Base mainnet. */
const BASE = "https://basescan.org";

export const BASESCAN_TX = (hash: string) => `${BASE}/tx/${hash}`;
export const BASESCAN_ADDRESS = (address: string) => `${BASE}/address/${address}`;
export const BASESCAN_TOKEN = (token: string, holder?: string) =>
  holder ? `${BASE}/token/${token}?a=${holder}` : `${BASE}/token/${token}`;
