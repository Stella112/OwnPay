import { parseUnits } from "viem";
import { SUPPORTED_TOKENS, tokenBySymbol } from "@/lib/tokens";
import { BASE_USDC_ADDRESS } from "@/lib/stablecoins";

export const RULE_BPS = 10_000;
export const USDC_DECIMALS = 6;

export type OwnershipRuleAllocation = {
  assetSymbol: string;
  assetAddress: string;
  weightBps: number;
};

/** Serialized rule shape. Financial quantities are integer strings, never floats. */
export type OwnershipRule = {
  id: string;
  userId: string;
  walletAddress: string;
  enabled: boolean;
  triggerAsset: "USDC";
  triggerAssetAddress: string;
  minimumPaymentRaw: string;
  allocationBps: number;
  allocations: OwnershipRuleAllocation[];
  maxPerPaymentRaw: string;
  maxDailyRaw: string;
  maxMonthlyRaw: string;
  slippageBps: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OwnershipRuleCandidate = {
  trigger: "incoming_usdc";
  minimum_payment: string;
  allocation_percent: string | number;
  allocations: Array<{ asset: string; weight_percent: string | number }>;
  max_per_payment: string;
  max_daily?: string;
  max_monthly: string;
};

export const OWNERSHIP_RULE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    trigger: { type: "string", enum: ["incoming_usdc"] },
    minimum_payment: { type: "string" },
    allocation_percent: { type: ["string", "number"] },
    allocations: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, properties: { asset: { type: "string", enum: SUPPORTED_TOKENS.map((token) => token.symbol) }, weight_percent: { type: ["string", "number"] } }, required: ["asset", "weight_percent"] } },
  max_per_payment: { type: "string" },
    max_daily: { type: "string" },
    max_monthly: { type: "string" },
  },
  required: ["trigger", "minimum_payment", "allocation_percent", "allocations", "max_per_payment", "max_monthly"],
} as const;

function decimalToBps(value: unknown, label: string): number {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label} must be a percentage with at most two decimal places.`);
  const [whole, fraction = ""] = raw.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps > RULE_BPS) throw new Error(`${label} must be between 0.01% and 100%.`);
  return bps;
}

function usdcToRaw(value: unknown, label: string): string {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) throw new Error(`${label} must be a positive USDC amount.`);
  const amount = parseUnits(raw, USDC_DECIMALS);
  if (amount <= 0n) throw new Error(`${label} must be greater than zero.`);
  return amount.toString();
}

export function validateOwnershipRuleCandidate(candidate: unknown, walletAddress: string): Omit<OwnershipRule, "id" | "userId" | "createdAt" | "updatedAt"> {
  if (!candidate || typeof candidate !== "object") throw new Error("The rule parser returned an invalid object.");
  const value = candidate as Partial<OwnershipRuleCandidate>;
  if (value.trigger !== "incoming_usdc") throw new Error("Only incoming Base USDC rules are supported.");
  if (!Array.isArray(value.allocations) || value.allocations.length === 0) throw new Error("Choose at least one verified stock asset.");
  const allocationBps = decimalToBps(value.allocation_percent, "Ownership allocation");
  const allocations = value.allocations.map((allocation) => {
    const assetSymbol = String(allocation?.asset ?? "");
    const token = tokenBySymbol(assetSymbol);
    if (!token) throw new Error(`${assetSymbol || "That asset"} is not a verified OwnPay stock.`);
    return { assetSymbol, assetAddress: token.address, weightBps: decimalToBps(allocation.weight_percent, `${assetSymbol} weight`) };
  });
  if (allocations.reduce((sum, allocation) => sum + allocation.weightBps, 0) !== RULE_BPS) throw new Error("Stock allocation weights must total 100%.");
  return {
    walletAddress,
    enabled: false,
    triggerAsset: "USDC",
    triggerAssetAddress: BASE_USDC_ADDRESS,
    minimumPaymentRaw: usdcToRaw(value.minimum_payment, "Minimum payment"),
    allocationBps,
    allocations,
    maxPerPaymentRaw: usdcToRaw(value.max_per_payment, "Maximum per payment"),
    maxDailyRaw: usdcToRaw(value.max_daily ?? value.max_per_payment, "Daily limit"),
    maxMonthlyRaw: usdcToRaw(value.max_monthly, "Monthly limit"),
    slippageBps: 0,
    version: 1,
  };
}
