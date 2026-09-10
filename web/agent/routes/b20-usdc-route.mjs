import { randomUUID } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { isAddress } from "viem";

export const BASE_CHAIN_ID = 8453;
export const BASE_CAIP2 = "eip155:8453";
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();

// These are the official Coinbase B20 listings on Base. The route layer is
// deliberately narrower than the UI: it accepts only these exact assets and
// never accepts arbitrary calldata or a user-supplied router.
export const VERIFIED_B20 = Object.freeze({
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb".toLowerCase(),
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C".toLowerCase(),
  METAc: "0xb2000000000000000000008bC8786B856E61707C".toLowerCase(),
  GOOGLc: "0xb2000000000000000000002D0BA3164cc74f58B7".toLowerCase(),
  AMZNc: "0xb200000000000000000000d9192b6B456483C2E8".toLowerCase(),
  MSFTc: "0xB200000000000000000000Ab99cFa739E253872B".toLowerCase(),
  MSTRc: "0xb2000000000000000000004884b426556b92883d".toLowerCase(),
  SNDKc: "0xb200000000000000000000397293Cb8cda9a10c5".toLowerCase(),
  SPCXc: "0xb2000000000000000000007b9fcbd005511aCBd5".toLowerCase(),
  TSLAc: "0xb2000000000000000000001e800a7f5189430cD0".toLowerCase(),
});

export class AutomationUnavailableError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "AutomationUnavailableError";
    this.code = "AUTOMATION_UNAVAILABLE";
  }
}

function positiveRaw(value, field) {
  try {
    const raw = BigInt(value);
    if (raw <= 0n) throw new Error();
    return raw;
  } catch {
    throw new Error(`INVALID_ROUTE_${field.toUpperCase()}`);
  }
}

function requireWalletId(request) {
  const walletId = String(request?.walletId || "").trim();
  if (!walletId || walletId.length > 200) throw new Error("INVALID_ROUTE_WALLET");
  return walletId;
}

/**
 * Validate the integer plan produced by the ownership-rule engine. Amounts in
 * this plan are USDC spend amounts; the stock output is determined by a fresh
 * quote and is never guessed from a stock price.
 */
export function validateRouteRequest(request) {
  if (Number(request?.chainId) !== BASE_CHAIN_ID) throw new Error("INVALID_ROUTE_CHAIN");
  if (String(request?.usdcAddress || "").toLowerCase() !== BASE_USDC_ADDRESS) {
    throw new Error("INVALID_ROUTE_USDC");
  }
  if (!isAddress(String(request?.recipient || ""))) throw new Error("INVALID_ROUTE_RECIPIENT");
  const slippageBps = Number(request?.slippageBps ?? 0);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1_000) {
    throw new Error("INVALID_ROUTE_SLIPPAGE");
  }

  const totalRaw = positiveRaw(request?.allocation?.totalRaw, "allocation");
  const allocations = request?.allocation?.allocations;
  if (!Array.isArray(allocations) || allocations.length === 0) throw new Error("INVALID_ROUTE_ALLOCATION");

  let sum = 0n;
  for (const allocation of allocations) {
    const symbol = String(allocation?.assetSymbol || "");
    const expectedAddress = VERIFIED_B20[symbol];
    if (!expectedAddress || String(allocation?.assetAddress || "").toLowerCase() !== expectedAddress) {
      throw new Error("UNSUPPORTED_ROUTE_ASSET");
    }
    const amountRaw = positiveRaw(allocation?.amountRaw, "asset_amount");
    sum += amountRaw;
  }
  if (sum !== totalRaw) throw new Error("INVALID_ROUTE_ALLOCATION_TOTAL");

  return {
    walletId: requireWalletId(request),
    chainId: BASE_CHAIN_ID,
    usdcAddress: BASE_USDC_ADDRESS,
    recipient: String(request.recipient).toLowerCase(),
    slippageBps,
    idempotencyKey: String(request.idempotencyKey || "").trim(),
    allocation: {
      totalRaw: totalRaw.toString(),
      allocations: allocations.map((allocation) => ({
        assetSymbol: String(allocation.assetSymbol),
        assetAddress: String(allocation.assetAddress).toLowerCase(),
        amountRaw: BigInt(allocation.amountRaw).toString(),
      })),
    },
  };
}

function unavailableReason() {
  if (process.env.OWNPAY_B20_ROUTE_ENABLED !== "true") return "ROUTE_DISABLED";
  if (String(process.env.OWNPAY_B20_VENUE || "").toLowerCase() !== "privy-uniswap") return "UNVERIFIED_VENUE";
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return "PRIVY_SERVER_NOT_CONFIGURED";
  if (!process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY) return "SERVER_SIGNER_NOT_CONFIGURED";
  return null;
}

function createPrivyClient() {
  return new PrivyClient({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
    requestExpiry: { defaultMs: 60_000 },
  });
}

function authorizationContext() {
  return { authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY] };
}

function swapParams(assetAddress, amountRaw, slippageBps) {
  return {
    base_amount: amountRaw,
    source: { asset_address: BASE_USDC_ADDRESS, caip2: BASE_CAIP2 },
    destination: { asset_address: assetAddress, caip2: BASE_CAIP2 },
    amount_type: "exact_input",
    ...(slippageBps > 0 ? { slippage_bps: slippageBps } : {}),
  };
}

function actionTransactionHashes(action) {
  return (Array.isArray(action?.steps) ? action.steps : [])
    .filter((step) => step?.type === "evm_transaction" && typeof step.transaction_hash === "string")
    .map((step) => step.transaction_hash);
}

async function quoteAllocations(client, normalized) {
  const swaps = client.wallets().swaps();
  const quotes = [];
  for (const allocation of normalized.allocation.allocations) {
    const quote = await swaps.quote(normalized.walletId, swapParams(allocation.assetAddress, allocation.amountRaw, normalized.slippageBps));
    quotes.push({
      assetSymbol: allocation.assetSymbol,
      assetAddress: allocation.assetAddress,
      spendRaw: allocation.amountRaw,
      estimatedOutputRaw: String(quote.est_output_amount),
      minimumOutputRaw: String(quote.minimum_output_amount),
      quote,
    });
  }
  return quotes;
}

/**
 * Privy delegates the swap route to its supported Uniswap integration. This
 * keeps router calldata out of OwnPay and lets Privy enforce the user's signer
 * and any policies attached to it.
 */
export function createB20UsdcRoute({ privyClient } = {}) {
  const reason = unavailableReason();
  if (reason) {
    return Object.freeze({
      status: Object.freeze({ enabled: false, code: "AUTOMATION_UNAVAILABLE", reason }),
      async quote(request) {
        validateRouteRequest(request);
        throw new AutomationUnavailableError(reason);
      },
      async execute(request) {
        validateRouteRequest(request);
        throw new AutomationUnavailableError(reason);
      },
      async verifyReceipt() {
        throw new AutomationUnavailableError("RECEIPT_VERIFICATION_NOT_ENABLED");
      },
    });
  }

  const client = privyClient ?? createPrivyClient();
  return Object.freeze({
    status: Object.freeze({ enabled: true, code: "READY", reason: "PRIVY_UNISWAP" }),
    async quote(request) {
      const normalized = validateRouteRequest(request);
      return { request: normalized, quotes: await quoteAllocations(client, normalized) };
    },
    async execute(request) {
      const normalized = validateRouteRequest(request);
      const quotes = await quoteAllocations(client, normalized);
      const swaps = client.wallets().swaps();
      const actions = [];
      for (const item of quotes) {
        const nonce = `${normalized.idempotencyKey || randomUUID()}-${item.assetSymbol}`;
        let action;
        try {
          action = await swaps.execute(normalized.walletId, {
            ...swapParams(item.assetAddress, item.spendRaw, normalized.slippageBps),
            nonce,
            idempotency_key: nonce,
            authorization_context: authorizationContext(),
          });
        } catch (error) {
          error.partialActions = actions;
          throw error;
        }
        actions.push({
          assetSymbol: item.assetSymbol,
          spendRaw: item.spendRaw,
          estimatedOutputRaw: item.estimatedOutputRaw,
          minimumOutputRaw: item.minimumOutputRaw,
          action,
          transactionHashes: actionTransactionHashes(action),
        });
      }
      return { request: normalized, quotes, actions };
    },
    async verifyReceipt(receipt) {
      const hashes = Array.isArray(receipt?.transactionHashes) ? receipt.transactionHashes.filter((hash) => typeof hash === "string") : [];
      if (hashes.length === 0) throw new AutomationUnavailableError("RECEIPT_NOT_BROADCAST");
      return { transactionHashes: hashes };
    },
  });
}
