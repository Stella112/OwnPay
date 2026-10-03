import { PrivyClient } from "@privy-io/node";
import { createPublicClient, http, parseAbi, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { BASE_USDC_ADDRESS, BASE_CAIP2, validateRouteRequest, AutomationUnavailableError } from "./b20-usdc-route.mjs";

export const DPRI = "0xc68b460fe4c916Fd17d6ab6b181A409C763002d9".toLowerCase();
export const CNGN = "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F".toLowerCase();
export const MARKET = "0x716B0B731f2FB292C74BD121485d930FA3dEA2DD".toLowerCase();
const IMPLEMENTATION = "0x1d73b31832240aaf0181b2e6e27f5a01c94f5ec5";
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const tokenAbi = parseAbi(["function payoutToken() view returns (address)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const marketAbi = parseAbi([
  "function getAsset(address) view returns ((address token,address vault,uint256 checkpointPrice,uint256 feeBps,bool isActive,uint256 lastUpdated,uint8 tokenDecimals))",
  "function calculateBuyCost(address,uint256) view returns (uint256 baseCost,uint256 fee,uint256 totalCost)",
  "function buy(address token,uint256 amount,uint256 maxCost)",
]);

export function validateDpriRequest(request) {
  const allocations = request?.allocation?.allocations;
  if (!Array.isArray(allocations) || allocations.length !== 1 || allocations[0].assetSymbol !== "DPRI" || String(allocations[0].assetAddress).toLowerCase() !== DPRI) throw new Error("INVALID_DPRI_ALLOCATION");
  // Reuse all chain, wallet, integer-budget and recipient validation without
  // representing DPRI as a B20 token in the public registry.
  const proxy = { ...request, allocation: { ...request.allocation, allocations: [{ ...allocations[0], assetSymbol: "AAPLc", assetAddress: "0xb200000000000000000000c2e324d24d7eecd1fb" }] } };
  const validated = validateRouteRequest(proxy);
  if (!validated.idempotencyKey) throw new Error("DPRI_EVENT_ID_REQUIRED");
  return { ...validated, allocation: { totalRaw: validated.allocation.totalRaw, allocations: [{ assetSymbol: "DPRI", assetAddress: DPRI, amountRaw: validated.allocation.totalRaw }] } };
}

// A conservative fractional purchase derived from the contract's own quote.
// It never uses a fiat FX rate or a guessed stock price.
export function affordableDpri(budget, unitCost) {
  if (BigInt(budget) <= 0n || BigInt(unitCost) <= 0n) throw new Error("INVALID_MARKET_QUOTE");
  const amount = BigInt(budget) * 10n ** 18n / BigInt(unitCost);
  if (!amount) throw new Error("DPRI_ALLOCATION_TOO_SMALL");
  return amount;
}

export function createDpriUsdcRoute({ privyClient, publicClient, enabled, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const configured = enabled ?? (process.env.OWNPAY_DPRI_ROUTE_ENABLED === "true" && !!appId && !!process.env.PRIVY_APP_SECRET && !!process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY);
  const status = { enabled: configured, reason: configured ? "GETEQUITY_VIA_CNGN" : "GETEQUITY_ROUTE_NOT_CONFIGURED" };
  const privy = configured ? privyClient ?? new PrivyClient({ appId, appSecret: process.env.PRIVY_APP_SECRET }) : null;
  const chain = publicClient ?? createPublicClient({ chain: base, transport: http(process.env.AGENT_RPC_URL || "https://mainnet.base.org", { timeout: 15000 }) });
  const auth = () => ({ authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY] });
  const swapParams = (request) => ({ base_amount: request.allocation.totalRaw, amount_type: "exact_input", slippage_bps: request.slippageBps, source: { asset_address: BASE_USDC_ADDRESS, caip2: BASE_CAIP2 }, destination: { asset_address: CNGN, caip2: BASE_CAIP2 } });
  async function assertWallet(request) {
    const wallet = await privy.wallets().get(request.walletId);
    if (wallet.chain_type !== "ethereum" || wallet.address.toLowerCase() !== request.recipient) throw new Error("DPRI_WALLET_RECIPIENT_MISMATCH");
  }
  async function purchaseQuote(budget) {
    const [slot, payout, asset] = await Promise.all([
      chain.getStorageAt({ address: MARKET, slot: SLOT }),
      chain.readContract({ address: DPRI, abi: tokenAbi, functionName: "payoutToken" }),
      chain.readContract({ address: MARKET, abi: marketAbi, functionName: "getAsset", args: [DPRI] }),
    ]);
    if (String(slot).slice(-40).toLowerCase() !== IMPLEMENTATION.slice(2)) throw new Error("GETEQUITY_IMPLEMENTATION_CHANGED");
    if (payout.toLowerCase() !== CNGN || asset.token.toLowerCase() !== DPRI || !asset.isActive || Number(asset.tokenDecimals) !== 18) throw new Error("GETEQUITY_MARKET_UNAVAILABLE");
    const unit = await chain.readContract({ address: MARKET, abi: marketAbi, functionName: "calculateBuyCost", args: [DPRI, 10n ** 18n] });
    const amount = affordableDpri(budget, unit[2]);
    const cost = await chain.readContract({ address: MARKET, abi: marketAbi, functionName: "calculateBuyCost", args: [DPRI, amount] });
    if (cost[2] <= 0n || cost[2] > BigInt(budget)) throw new Error("DPRI_PRICE_CHANGED");
    const inventory = await chain.readContract({ address: DPRI, abi: tokenAbi, functionName: "balanceOf", args: [asset.vault] });
    if (inventory < amount) throw new Error("DPRI_INSUFFICIENT_LIQUIDITY");
    return { amount, cost: cost[2] };
  }
  async function quote(request) {
    const normalized = validateDpriRequest(request);
    if (!configured) throw new AutomationUnavailableError(status.reason);
    await assertWallet(normalized);
    let swap;
    try { swap = await privy.wallets().swaps().quote(normalized.walletId, swapParams(normalized)); }
    catch (error) {
      if (error.status === 403) throw new AutomationUnavailableError("PRIVY_SWAPS_NOT_ENABLED");
      throw new AutomationUnavailableError("USDC_CNGN_QUOTE_UNAVAILABLE");
    }
    if (!/^\d+$/.test(String(swap.minimum_output_amount)) || BigInt(swap.minimum_output_amount) <= 0n) throw new Error("INVALID_CNGN_OUTPUT");
    const purchase = await purchaseQuote(BigInt(swap.minimum_output_amount));
    return { request: normalized, swap, purchase };
  }
  return {
    status, quote,
    async execute(request) {
      // Persist every phase before signing. After an ambiguous error the worker
      // leaves the receipt PARTIAL for review, never repeats the whole route.
      const checkpoint = request.checkpoint;
      if (typeof checkpoint !== "function") throw new Error("DPRI_DURABLE_CHECKPOINT_REQUIRED");
      const quoted = await quote(request);
      const normalized = quoted.request;
      const stages = [];
      async function save(stage) { stages.push(stage); await checkpoint(stages); }
      try {
        await save({ stage: "SWAP_SUBMITTING" });
        let action = await privy.wallets().swaps().execute(normalized.walletId, { ...swapParams(normalized), nonce: `${normalized.idempotencyKey}-cngn`, idempotency_key: `${normalized.idempotencyKey}-cngn`, authorization_context: auth() });
        await save({ stage: "SWAP_SUBMITTED", actionId: action.id });
        for (let attempt = 0; action.status === "pending" && attempt < 30; attempt++) {
          await wait(2000);
          action = await privy.wallets().actions.get(action.id, { wallet_id: normalized.walletId, include: "steps" });
        }
        if (action.status !== "succeeded" || !action.output_amount || BigInt(action.output_amount) < BigInt(quoted.swap.minimum_output_amount) || action.output_token.toLowerCase() !== CNGN) throw new Error("CNGN_SWAP_NOT_CONFIRMED");
        const swapHashes = (action.steps || []).flatMap((step) => typeof step.transaction_hash === "string" ? [step.transaction_hash] : []);
        await save({ stage: "SWAP_CONFIRMED", actionId: action.id, cngnRaw: action.output_amount, transactionHashes: swapHashes });
        const purchase = await purchaseQuote(BigInt(action.output_amount));
        const allowance = await chain.readContract({ address: CNGN, abi: tokenAbi, functionName: "allowance", args: [normalized.recipient, MARKET] });
        const hashes = [...swapHashes];
        async function send(stage, address, abi, functionName, args) {
          await chain.simulateContract({ address, abi, functionName, args, account: normalized.recipient });
          await save({ stage: `${stage}_SUBMITTING`, amountRaw: purchase.amount.toString(), maxCostRaw: purchase.cost.toString() });
          const sent = await privy.wallets().ethereum().sendTransaction(normalized.walletId, { caip2: BASE_CAIP2, params: { transaction: { to: address, data: encodeFunctionData({ abi, functionName, args }), value: "0x0", chain_id: 8453 } }, idempotency_key: `${normalized.idempotencyKey}-${stage}`, authorization_context: auth() });
          hashes.push(sent.hash);
          await save({ stage: `${stage}_SUBMITTED`, transactionHash: sent.hash });
          const receipt = await chain.waitForTransactionReceipt({ hash: sent.hash, confirmations: 2, timeout: 60000 });
          if (receipt.status !== "success") throw new Error(`${stage}_REVERTED`);
          return receipt;
        }
        if (allowance < purchase.cost) {
          if (allowance > 0n) await send("RESET_APPROVAL", CNGN, tokenAbi, "approve", [MARKET, 0n]);
          await send("APPROVE_CNGN", CNGN, tokenAbi, "approve", [MARKET, purchase.cost]);
        }
        const receipt = await send("BUY_DPRI", MARKET, marketAbi, "buy", [DPRI, purchase.amount, purchase.cost]);
        // Verify that this purchase actually delivered DPRI to the rule wallet.
        const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const delivered = receipt.logs.filter((log) => log.address.toLowerCase() === DPRI && log.topics[0] === transferTopic && log.topics[2]?.slice(-40).toLowerCase() === normalized.recipient.slice(2)).reduce((sum, log) => sum + BigInt(log.data), 0n);
        if (delivered < purchase.amount) throw new Error("DPRI_DELIVERY_NOT_VERIFIED");
        await save({ stage: "DPRI_CONFIRMED", amountRaw: delivered.toString() });
        return { actions: [{ assetSymbol: "DPRI", estimatedOutputRaw: delivered.toString(), minimumOutputRaw: purchase.amount.toString(), action: { status: "succeeded" }, transactionHashes: hashes }] };
      } catch (error) {
        error.partialActions = stages.length ? [{ assetSymbol: "DPRI", action: { status: "pending" }, transactionHashes: stages.flatMap((stage) => stage.transactionHash ? [stage.transactionHash] : []) }] : [];
        throw error;
      }
    },
  };
}
