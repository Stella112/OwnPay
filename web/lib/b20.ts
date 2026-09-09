import type { Abi, Address } from "viem";

/**
 * Minimal structural type for the reads we perform. Decouples this helper from
 * viem's exact PublicClient type (whose chain-specific getBlock overloads clash
 * with the client wagmi returns for Base).
 */
export type ReadClient = {
  readContract(args: {
    address: Address;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

/**
 * Centralized B20 conversion layer (spec A2/A6/A7).
 *
 * All escrow/vesting accounting is in RAW B20 units. Converting between RAW and
 * UI (a.k.a. "scaled") units is a *display* concern and must go through here so
 * the logic is tested once and stays correct across multiplier changes.
 *
 * Preference order. Verified against the official AAPLc/NVDAc tokens on Base
 * mainnet (chainId 8453) on 2026-09-09: the real B20 surface is
 * scaledBalanceOf/toScaledBalance/toRawBalance/multiplier. `toUIAmount` /
 * `fromUIAmount` do NOT exist on the real token, so they are only a forward-compat
 * secondary attempt, never the primary path:
 *   raw -> ui (scaled) :  toScaledBalance(raw)  then toUIAmount(raw)
 *   ui (scaled) -> raw :  toRawBalance(scaled)  then fromUIAmount(scaled)
 *
 * We NEVER silently fall back to `raw = ui` just because the current multiplier
 * looks like 1 — that would break the moment a corporate action changes it.
 */

export class UnsupportedB20AssetError extends Error {
  token: Address;
  constructor(token: Address) {
    super(`Token ${token} does not expose B20 conversion selectors`);
    this.name = "UnsupportedB20AssetError";
    this.token = token;
  }
}

// Minimal ABI fragments for the functions we probe.
const toUIAmountAbi = [
  { type: "function", name: "toUIAmount", stateMutability: "view", inputs: [{ name: "rawAmount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
const toScaledBalanceAbi = [
  { type: "function", name: "toScaledBalance", stateMutability: "view", inputs: [{ name: "rawAmount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
const fromUIAmountAbi = [
  { type: "function", name: "fromUIAmount", stateMutability: "view", inputs: [{ name: "uiAmount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
const toRawBalanceAbi = [
  { type: "function", name: "toRawBalance", stateMutability: "view", inputs: [{ name: "scaledAmount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
const decimalsAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Which selector works for a given token, cached so we probe only once.
type RawToUiFn = "toUIAmount" | "toScaledBalance";
type UiToRawFn = "fromUIAmount" | "toRawBalance";
const rawToUiSelector = new Map<string, RawToUiFn>();
const uiToRawSelector = new Map<string, UiToRawFn>();
const decimalsCache = new Map<string, number>();

const key = (token: Address) => token.toLowerCase();

async function tryRead(
  client: ReadClient,
  token: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any,
  functionName: string,
  args: readonly unknown[],
): Promise<bigint | undefined> {
  try {
    const result = await client.readContract({ address: token, abi, functionName, args });
    return result as bigint;
  } catch {
    return undefined; // selector absent or reverted
  }
}

/** RAW B20 units -> UI (scaled) units. Throws if the asset is unsupported. */
export async function rawToUi(client: ReadClient, token: Address, rawAmount: bigint): Promise<bigint> {
  const k = key(token);
  const cached = rawToUiSelector.get(k);
  if (cached === "toUIAmount") return callRawToUi(client, token, rawAmount, "toUIAmount");
  if (cached === "toScaledBalance") return callRawToUi(client, token, rawAmount, "toScaledBalance");

  const viaScaled = await tryRead(client, token, toScaledBalanceAbi, "toScaledBalance", [rawAmount]);
  if (viaScaled !== undefined) {
    rawToUiSelector.set(k, "toScaledBalance");
    return viaScaled;
  }
  const viaUi = await tryRead(client, token, toUIAmountAbi, "toUIAmount", [rawAmount]);
  if (viaUi !== undefined) {
    rawToUiSelector.set(k, "toUIAmount");
    return viaUi;
  }
  throw new UnsupportedB20AssetError(token);
}

async function callRawToUi(client: ReadClient, token: Address, rawAmount: bigint, fn: RawToUiFn): Promise<bigint> {
  const abi = fn === "toUIAmount" ? toUIAmountAbi : toScaledBalanceAbi;
  const v = await tryRead(client, token, abi, fn, [rawAmount]);
  if (v === undefined) throw new UnsupportedB20AssetError(token);
  return v;
}

/** UI (scaled) units -> RAW B20 units. Throws if the asset is unsupported. */
export async function uiToRaw(client: ReadClient, token: Address, uiAmount: bigint): Promise<bigint> {
  const k = key(token);
  const cached = uiToRawSelector.get(k);
  if (cached === "fromUIAmount") return callUiToRaw(client, token, uiAmount, "fromUIAmount");
  if (cached === "toRawBalance") return callUiToRaw(client, token, uiAmount, "toRawBalance");

  const viaRaw = await tryRead(client, token, toRawBalanceAbi, "toRawBalance", [uiAmount]);
  if (viaRaw !== undefined) {
    uiToRawSelector.set(k, "toRawBalance");
    return viaRaw;
  }
  const viaUi = await tryRead(client, token, fromUIAmountAbi, "fromUIAmount", [uiAmount]);
  if (viaUi !== undefined) {
    uiToRawSelector.set(k, "fromUIAmount");
    return viaUi;
  }
  throw new UnsupportedB20AssetError(token);
}

async function callUiToRaw(client: ReadClient, token: Address, uiAmount: bigint, fn: UiToRawFn): Promise<bigint> {
  const abi = fn === "fromUIAmount" ? fromUIAmountAbi : toRawBalanceAbi;
  const v = await tryRead(client, token, abi, fn, [uiAmount]);
  if (v === undefined) throw new UnsupportedB20AssetError(token);
  return v;
}

/** Read token decimals dynamically (spec C1: never hardcode 18). Cached per token. */
export async function getDecimals(client: ReadClient, token: Address): Promise<number> {
  const k = key(token);
  const cached = decimalsCache.get(k);
  if (cached !== undefined) return cached;
  const d = await client.readContract({ address: token, abi: decimalsAbi, functionName: "decimals" });
  const n = Number(d);
  decimalsCache.set(k, n);
  return n;
}

/**
 * Returns whether a token exposes the B20 conversion surface at all. Used at
 * runtime to verify the supported assets (spec C1) rather than trusting docs.
 */
export async function isSupportedB20(client: ReadClient, token: Address): Promise<boolean> {
  try {
    await rawToUi(client, token, 0n);
    await uiToRaw(client, token, 0n);
    return true;
  } catch {
    return false;
  }
}

/** For tests/instrumentation only: forget cached selector probing. */
export function _resetB20Caches() {
  rawToUiSelector.clear();
  uiToRawSelector.clear();
  decimalsCache.clear();
}
