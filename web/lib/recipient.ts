import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { normalize } from "viem/ens";

/** Minimal structural client type for ENS/Basename reads (decoupled from viem's PublicClient). */
export type NameClient = {
  getEnsAddress(args: { name: string; universalResolverAddress: Address }): Promise<Address | null>;
  getEnsName(args: { address: Address; universalResolverAddress: Address }): Promise<string | null>;
};

/**
 * Recipient resolution (spec C7).
 *
 * Rules:
 *  - A syntactically valid EVM address is accepted (checksummed).
 *  - A Basename (`*.base.eth`, or `*.eth`) is resolved onchain. If it cannot be
 *    resolved, the recipient is BLOCKED — an unresolved name must never reach a
 *    transaction.
 *  - Reverse lookup (address -> name) is display-only and never gates sending.
 *
 * Base Basename resolution needs a UniversalResolver address. Rather than ship a
 * guessed address, it is read from NEXT_PUBLIC_BASENAME_UNIVERSAL_RESOLVER. Until
 * that is set to a verified value, Basename resolution reports "unavailable" and
 * raw addresses still work — we never resolve against an unverified resolver.
 */

const UNIVERSAL_RESOLVER = process.env.NEXT_PUBLIC_BASENAME_UNIVERSAL_RESOLVER as
  | Address
  | undefined;

export type ResolvedRecipient = {
  address: Address;
  source: "address" | "basename";
  name?: string;
};

export type RecipientResult =
  | { ok: true; value: ResolvedRecipient }
  | { ok: false; error: "invalid" | "unresolved" | "basename-unavailable"; message: string };

function looksLikeName(input: string): boolean {
  return /\.(base\.)?eth$/i.test(input) && !input.includes(" ");
}

export async function resolveRecipient(
  client: NameClient,
  rawInput: string,
): Promise<RecipientResult> {
  const input = rawInput.trim();
  if (input.length === 0) {
    return { ok: false, error: "invalid", message: "Enter a wallet address or Basename." };
  }

  if (isAddress(input)) {
    return { ok: true, value: { address: getAddress(input), source: "address" } };
  }

  if (looksLikeName(input)) {
    if (!UNIVERSAL_RESOLVER || !isAddress(UNIVERSAL_RESOLVER)) {
      return {
        ok: false,
        error: "basename-unavailable",
        message: "Basename resolution isn't configured yet. Paste a wallet address instead.",
      };
    }
    let name: string;
    try {
      name = normalize(input);
    } catch {
      return { ok: false, error: "invalid", message: "That doesn't look like a valid name." };
    }
    try {
      const address = await client.getEnsAddress({
        name,
        universalResolverAddress: UNIVERSAL_RESOLVER,
      });
      if (!address) {
        return { ok: false, error: "unresolved", message: `${input} doesn't resolve to an address.` };
      }
      return { ok: true, value: { address: getAddress(address), source: "basename", name } };
    } catch {
      return { ok: false, error: "unresolved", message: `Couldn't resolve ${input}.` };
    }
  }

  return {
    ok: false,
    error: "invalid",
    message: "Enter a valid wallet address (0x…) or a Basename ending in .base.eth.",
  };
}

/** Display-only reverse lookup. Returns undefined on any failure; never throws. */
export async function lookupName(
  client: NameClient,
  address: Address,
): Promise<string | undefined> {
  if (!UNIVERSAL_RESOLVER || !isAddress(UNIVERSAL_RESOLVER)) return undefined;
  try {
    const name = await client.getEnsName({ address, universalResolverAddress: UNIVERSAL_RESOLVER });
    return name ?? undefined;
  } catch {
    return undefined;
  }
}

/** Truncate an address for display: 0x1234…abcd. */
export function shortAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
