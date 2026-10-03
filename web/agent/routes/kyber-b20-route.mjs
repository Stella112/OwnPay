import { PrivyClient } from "@privy-io/node";
import { createPublicClient, http, parseAbi, decodeFunctionData, encodeFunctionData, zeroAddress } from "viem";
import { base } from "viem/chains";
import { BASE_USDC_ADDRESS, BASE_CAIP2, validateRouteRequest, AutomationUnavailableError } from "./b20-usdc-route.mjs";

// Pinned Base contracts from Kyber's published registry and verified router ABI.
export const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
export const KYBER_EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
const API = "https://aggregator-api.kyberswap.com/base/api/v1";
export const KYBER_ABI = parseAbi([
  "struct Desc { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct Execution { address callTarget; address approveTarget; bytes targetData; Desc desc; bytes clientData; }",
  "function swap(Execution execution) payable returns (uint256 returnAmount, uint256 gasUsed)",
]);
const TOKEN_ABI = parseAbi(["function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const lower = (value) => String(value).toLowerCase();
function requireSafe(condition, reason) { if (!condition) throw new Error(reason); }

export function validateKyberBuild(built, allocation, request) {
  requireSafe(lower(built?.routerAddress) === KYBER_ROUTER && String(built.transactionValue) === "0", "KYBER_UNSAFE_TRANSACTION");
  requireSafe(String(built.amountIn) === allocation.amountRaw && /^\d+$/.test(String(built.amountOut)) && BigInt(built.amountOut) > 0n, "KYBER_INVALID_AMOUNTS");
  const decoded = decodeFunctionData({ abi: KYBER_ABI, data: built.data });
  const execution = decoded.args[0];
  const desc = execution.desc;
  requireSafe(decoded.functionName === "swap" && lower(execution.callTarget) === KYBER_EXECUTOR && lower(execution.approveTarget) === zeroAddress && execution.targetData !== "0x", "KYBER_UNVERIFIED_EXECUTOR");
  requireSafe(lower(desc.srcToken) === BASE_USDC_ADDRESS && lower(desc.dstToken) === allocation.assetAddress && lower(desc.dstReceiver) === request.recipient, "KYBER_TOKEN_OR_RECIPIENT_MISMATCH");
  requireSafe(desc.amount === BigInt(allocation.amountRaw) && desc.permit === "0x", "KYBER_UNSAFE_SPEND");
  // No partial fills, extra ETH, burns, simple-mode pool transfers, or fees.
  // 0x200 is emitted by the current API; the verified V2 router ignores it.
  requireSafe((desc.flags === 0n || desc.flags === 512n) && desc.feeReceivers.length === 0 && desc.feeAmounts.length === 0, "KYBER_UNSAFE_FLAGS_OR_FEES");
  requireSafe(desc.srcReceivers.length === 1 && lower(desc.srcReceivers[0]) === KYBER_EXECUTOR && desc.srcAmounts.length === 1 && desc.srcAmounts[0] === desc.amount, "KYBER_UNSAFE_INPUT_TRANSFER");
  const minimum = BigInt(built.amountOut) * BigInt(10000 - request.slippageBps) / 10000n;
  requireSafe(minimum > 0n && desc.minReturnAmount >= minimum && desc.minReturnAmount <= BigInt(built.amountOut), "KYBER_SLIPPAGE_MISMATCH");
  // Re-encoding rejects trailing calldata or noncanonical hidden arguments.
  requireSafe(lower(encodeFunctionData({ abi: KYBER_ABI, functionName: "swap", args: [execution] })) === lower(built.data), "KYBER_NONCANONICAL_CALLDATA");
  return { ...allocation, estimatedOutputRaw: String(built.amountOut), minimumOutputRaw: desc.minReturnAmount.toString(), data: built.data };
}

export function createKyberB20Route({ privyClient, publicClient, fetchImpl = fetch, enabled, now = Date.now } = {}) {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const configured = enabled ?? (process.env.OWNPAY_B20_ROUTE_ENABLED === "true" && process.env.OWNPAY_B20_VENUE === "kyberswap" && !!appId && !!process.env.PRIVY_APP_SECRET && !!process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY);
  const status = Object.freeze({ enabled: configured, reason: configured ? "KYBERSWAP_BASE" : "KYBERSWAP_NOT_CONFIGURED" });
  const privy = configured ? privyClient ?? new PrivyClient({ appId, appSecret: process.env.PRIVY_APP_SECRET }) : null;
  const chain = publicClient ?? createPublicClient({ chain: base, transport: http(process.env.AGENT_RPC_URL || "https://mainnet.base.org", { timeout: 15000 }) });
  async function json(path, body) {
    const response = await fetchImpl(`${API}${path}`, { method: body ? "POST" : "GET", headers: { "x-client-id": "OwnPay", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new AutomationUnavailableError(`KYBER_HTTP_${response.status}`);
    const result = await response.json();
    if (result.code !== 0 || !result.data) throw new AutomationUnavailableError("KYBER_ROUTE_UNAVAILABLE");
    return result.data;
  }
  async function build(allocation, request) {
    const params = new URLSearchParams({ tokenIn: BASE_USDC_ADDRESS, tokenOut: allocation.assetAddress, amountIn: allocation.amountRaw, origin: request.recipient, excludeRFQSources: "true" });
    const quote = await json(`/routes?${params}`);
    const summary = quote.routeSummary;
    requireSafe(lower(quote.routerAddress) === KYBER_ROUTER && lower(summary?.tokenIn) === BASE_USDC_ADDRESS && lower(summary?.tokenOut) === allocation.assetAddress && String(summary?.amountIn) === allocation.amountRaw, "KYBER_INVALID_QUOTE");
    const built = await json("/route/build", { routeSummary: summary, sender: request.recipient, recipient: request.recipient, slippageTolerance: request.slippageBps, deadline: Math.floor(now() / 1000) + 300 });
    return { ...validateKyberBuild(built, allocation, request), builtAt: now() };
  }
  async function quote(request) {
    const normalized = validateRouteRequest(request);
    requireSafe(new Set(normalized.allocation.allocations.map((item) => item.assetSymbol)).size === normalized.allocation.allocations.length, "KYBER_DUPLICATE_ALLOCATION");
    if (!configured) throw new AutomationUnavailableError(status.reason);
    const quotes = [];
    for (const allocation of normalized.allocation.allocations) quotes.push(await build(allocation, normalized));
    return { request: normalized, quotes };
  }
  return { status, quote,
    async execute(request) {
      const normalized = validateRouteRequest(request);
      if (!configured) throw new AutomationUnavailableError(status.reason);
      requireSafe(normalized.idempotencyKey && typeof request.checkpoint === "function", "KYBER_CHECKPOINT_REQUIRED");
      const wallet = await privy.wallets().get(normalized.walletId);
      requireSafe(wallet.chain_type === "ethereum" && lower(wallet.address) === normalized.recipient, "KYBER_WALLET_MISMATCH");
      requireSafe(await chain.getChainId() === 8453, "KYBER_RPC_CHAIN_MISMATCH");
      const balance = await chain.readContract({ address: BASE_USDC_ADDRESS, abi: TOKEN_ABI, functionName: "balanceOf", args: [normalized.recipient] });
      requireSafe(balance >= BigInt(normalized.allocation.totalRaw), "KYBER_INSUFFICIENT_USDC");
      requireSafe(await chain.getBalance({ address: normalized.recipient }) > 0n, "KYBER_BASE_ETH_REQUIRED");
      // Validate every destination before any approval; rebuild after approvals.
      await quote(normalized);
      const stages = [], actions = [];
      async function save(stage) { stages.push(stage); await request.checkpoint([...stages]); }
      async function send(stage, allocation, to, data, freshAt) {
        const transaction = { account: normalized.recipient, to, data, value: 0n };
        await chain.call(transaction);
        const gas = await chain.estimateGas(transaction);
        const gasPrice = await chain.getGasPrice();
        // Reserve twice the execution estimate, plus a conservative Base L1 fee.
        requireSafe(await chain.getBalance({ address: normalized.recipient }) >= gas * gasPrice * 2n + 10000000000000n, "KYBER_INSUFFICIENT_BASE_ETH");
        if (freshAt) requireSafe(now() - freshAt <= 10000, "KYBER_QUOTE_EXPIRED");
        await save({ stage: `${stage}_SUBMITTING`, assetSymbol: allocation.assetSymbol, spendRaw: allocation.amountRaw });
        if (freshAt) requireSafe(now() - freshAt <= 10000, "KYBER_QUOTE_EXPIRED");
        const sent = await privy.wallets().ethereum().sendTransaction(normalized.walletId, { caip2: BASE_CAIP2, params: { transaction: { to, data, value: "0x0", chain_id: 8453, gas_limit: `0x${(gas * 12n / 10n).toString(16)}` } }, idempotency_key: `${normalized.idempotencyKey}-${allocation.assetSymbol}-${stage}`, authorization_context: { authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY] } });
        requireSafe(/^0x[\da-f]{64}$/i.test(sent.hash), "KYBER_TRANSACTION_HASH_MISSING");
        await save({ stage: `${stage}_SUBMITTED`, assetSymbol: allocation.assetSymbol, transactionHash: sent.hash });
        const receipt = await chain.waitForTransactionReceipt({ hash: sent.hash, confirmations: 2, timeout: 60000 });
        requireSafe(receipt.status === "success", `${stage}_REVERTED`);
        await save({ stage: `${stage}_CONFIRMED`, assetSymbol: allocation.assetSymbol, transactionHash: sent.hash });
        return receipt;
      }
      try {
        for (const allocation of normalized.allocation.allocations) {
          const allowance = await chain.readContract({ address: BASE_USDC_ADDRESS, abi: TOKEN_ABI, functionName: "allowance", args: [normalized.recipient, KYBER_ROUTER] });
          // Narrow even a pre-existing unlimited allowance to this exact spend.
          if (allowance !== BigInt(allocation.amountRaw)) {
            if (allowance > 0n) await send("RESET_USDC", allocation, BASE_USDC_ADDRESS, encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [KYBER_ROUTER, 0n] }));
            await send("APPROVE_USDC", allocation, BASE_USDC_ADDRESS, encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [KYBER_ROUTER, BigInt(allocation.amountRaw)] }));
          }
          const built = await build(allocation, normalized);
          const receipt = await send("KYBER_SWAP", allocation, KYBER_ROUTER, built.data, built.builtAt);
          // Net ERC20 movement in THIS receipt, not a rounded UI stock balance.
          const delivered = receipt.logs.filter((log) => lower(log.address) === allocation.assetAddress && lower(log.topics[0]) === TRANSFER).reduce((sum, log) => sum + (lower(log.topics[2]?.slice(-40)) === normalized.recipient.slice(2) ? BigInt(log.data) : 0n) - (lower(log.topics[1]?.slice(-40)) === normalized.recipient.slice(2) ? BigInt(log.data) : 0n), 0n);
          requireSafe(delivered >= BigInt(built.minimumOutputRaw), "KYBER_STOCK_DELIVERY_NOT_VERIFIED");
          const spent = receipt.logs.filter((log) => lower(log.address) === BASE_USDC_ADDRESS && lower(log.topics[0]) === TRANSFER).reduce((sum, log) => sum + (lower(log.topics[1]?.slice(-40)) === normalized.recipient.slice(2) ? BigInt(log.data) : 0n) - (lower(log.topics[2]?.slice(-40)) === normalized.recipient.slice(2) ? BigInt(log.data) : 0n), 0n);
          requireSafe(spent === BigInt(allocation.amountRaw), "KYBER_USDC_SPEND_NOT_VERIFIED");
          actions.push({ assetSymbol: allocation.assetSymbol, spendRaw: allocation.amountRaw, estimatedOutputRaw: delivered.toString(), minimumOutputRaw: built.minimumOutputRaw, action: { status: "succeeded" }, transactionHashes: stages.filter((s) => s.assetSymbol === allocation.assetSymbol && s.stage.endsWith("_SUBMITTED")).map((s) => s.transactionHash) });
          await save({ stage: "STOCK_DELIVERED", assetSymbol: allocation.assetSymbol, amountRaw: delivered.toString() });
        }
        return { request: normalized, actions };
      } catch (error) {
        // Ambiguous submissions remain PARTIAL for review, never replayed blindly.
        error.partialActions = stages.length ? [...actions, { action: { status: "pending" }, transactionHashes: stages.filter((s) => s.stage.endsWith("_SUBMITTED")).map((s) => s.transactionHash) }] : [];
        throw error;
      }
    },
  };
}
