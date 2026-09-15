import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { namehash, normalize } from "viem/ens";

/** Minimal structural client type for Base Basename reads (decoupled from viem's PublicClient). */
export type NameClient = {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

/**
 * Recipient resolution (spec C7).
 *
 * Rules:
 *  - A syntactically valid EVM address is accepted (checksummed).
 *  - A Basename (`*.base.eth`) is resolved onchain. If it cannot be
 *    resolved, the recipient is BLOCKED — an unresolved name must never reach a
 *    transaction.
 *  - Reverse lookup (address -> name) is display-only and never gates sending.
 *
 * Base does not use Ethereum's UniversalResolver for native Basenames. Resolution
 * is a two-step read through the official Base Registry and the name's L2Resolver.
 * These addresses are published by Base's basenames repository.
 */

const BASE_BASENAMES_REGISTRY = "0xb94704422c2a1e396835a571837aa5ae53285a95" as Address;

const registryAbi = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const resolverAbi = [
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export type ResolvedRecipient = {
  address: Address;
  source: "address" | "basename";
  name?: string;
};

export type RecipientResult =
  | { ok: true; value: ResolvedRecipient }
  | { ok: false; error: "invalid" | "unresolved" | "basename-unavailable"; message: string };

function looksLikeName(input: string): boolean {
  return /\.base\.eth$/i.test(input) && !input.includes(" ");
}

async function readBasenameAddress(client: NameClient, name: string): Promise<Address | null> {
  const node = namehash(name);
  const resolver = (await client.readContract({
    address: BASE_BASENAMES_REGISTRY,
    abi: registryAbi,
    functionName: "resolver",
    args: [node],
  })) as Address;

  if (!resolver || !isAddress(resolver) || /^0x0{40}$/i.test(resolver)) return null;

  const address = (await client.readContract({
    address: getAddress(resolver),
    abi: resolverAbi,
    functionName: "addr",
    args: [node],
  })) as Address;

  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) return null;
  return getAddress(address);
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
    let name: string;
    try {
      name = normalize(input);
    } catch {
      return { ok: false, error: "invalid", message: "That doesn't look like a valid name." };
    }
    try {
      const address = await readBasenameAddress(client, name);
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
  try {
    const reverseNode = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
    const resolver = (await client.readContract({
      address: BASE_BASENAMES_REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [reverseNode],
    })) as Address;
    if (!resolver || !isAddress(resolver) || /^0x0{40}$/i.test(resolver)) return undefined;
    const name = (await client.readContract({
      address: getAddress(resolver),
      abi: resolverAbi,
      functionName: "name",
      args: [reverseNode],
    })) as string;
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Truncate an address for display: 0x1234…abcd. */
export function shortAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
