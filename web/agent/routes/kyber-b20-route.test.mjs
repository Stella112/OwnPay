import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, zeroAddress } from "viem";
import { createKyberB20Route, validateKyberBuild, KYBER_ABI, KYBER_ROUTER, KYBER_EXECUTOR } from "./kyber-b20-route.mjs";
import { BASE_USDC_ADDRESS, VERIFIED_B20 } from "./b20-usdc-route.mjs";

const recipient = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
const allocation = { assetSymbol: "NVDAc", assetAddress: VERIFIED_B20.NVDAc, amountRaw: "1000000" };
const request = { chainId: 8453, usdcAddress: BASE_USDC_ADDRESS, recipient, walletId: "test-wallet", slippageBps: 100, idempotencyKey: "event-one", allocation: { totalRaw: "1000000", allocations: [allocation] } };
function build(overrides = {}) {
  const desc = { srcToken: BASE_USDC_ADDRESS, dstToken: allocation.assetAddress, srcReceivers: [KYBER_EXECUTOR], srcAmounts: [1000000n], feeReceivers: [], feeAmounts: [], dstReceiver: recipient, amount: 1000000n, minReturnAmount: 990n, flags: 512n, permit: "0x", ...overrides };
  return { routerAddress: KYBER_ROUTER, transactionValue: "0", amountIn: "1000000", amountOut: "1000", data: encodeFunctionData({ abi: KYBER_ABI, functionName: "swap", args: [{ callTarget: KYBER_EXECUTOR, approveTarget: zeroAddress, targetData: "0x1234", desc, clientData: "0x" }] }) };
}
function harness({ allowance = 0n, badReceipt = false, rejectSend = false, secondBuildFails = false, gasBalance = 1000000000000000n, stale = false, noQuote = false } = {}) {
  const sent = [], checkpoints = [];
  let builds = 0;
  const chain = {
    getChainId: async () => 8453,
    getBalance: async () => gasBalance,
    getGasPrice: async () => 10000000n,
    estimateGas: async () => 500000n,
    call: async () => ({}),
    readContract: async ({ functionName }) => functionName === "allowance" ? allowance : 1000000n,
    waitForTransactionReceipt: async ({ hash }) => ({ status: "success", transactionHash: hash, logs: sent.at(-1).params.transaction.to === KYBER_ROUTER ? [
      transfer(allocation.assetAddress, KYBER_EXECUTOR, recipient, badReceipt ? 1n : 1000n),
      transfer(BASE_USDC_ADDRESS, recipient, KYBER_EXECUTOR, 1000000n),
    ] : [] }),
  };
  const privy = { wallets: () => ({ get: async () => ({ chain_type: "ethereum", address: recipient }), ethereum: () => ({ sendTransaction: async (_wallet, params) => { sent.push(params); if (rejectSend) throw new Error("AMBIGUOUS_SEND"); return { hash: `0x${String(sent.length).padStart(64, "0")}` }; } }) }) };
  let clock = 100000;
  const route = createKyberB20Route({ enabled: true, privyClient: privy, publicClient: chain, now: () => { const value = clock; if (stale && sent.length) clock += 11000; return value; }, fetchImpl: async (url) => ({ ok: !noQuote, status: 429, json: async () => {
    if (url.includes("/routes?")) return { code: 0, data: { routerAddress: KYBER_ROUTER, routeSummary: { tokenIn: BASE_USDC_ADDRESS, tokenOut: allocation.assetAddress, amountIn: allocation.amountRaw } } };
    builds++;
    if (secondBuildFails && builds > 1) throw new Error("BUILD_FAILED");
    return { code: 0, data: build() };
  } }) });
  return { route, sent, checkpoints, chain, request: { ...request, checkpoint: async (stages) => checkpoints.push(stages) } };
}
function transfer(address, from, to, amount) {
  return { address, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${from.slice(2).padStart(64, "0")}`, `0x${to.slice(2).padStart(64, "0")}`], data: `0x${amount.toString(16)}` };
}
test("accepts only the pinned exact-input USDC to stock build", () => {
  assert.equal(validateKyberBuild(build(), allocation, request).minimumOutputRaw, "990");
});
test("rejects changed recipients, assets, amounts, fees, permit, flags and transfers", () => {
  for (const override of [{ dstReceiver: other }, { dstToken: other }, { srcToken: other }, { amount: 2000000n }, { feeReceivers: [other], feeAmounts: [1n] }, { permit: "0x1234" }, { flags: 1n }, { flags: 32n }, { minReturnAmount: 989n }, { srcReceivers: [other] }, { srcAmounts: [2000000n] }]) assert.throws(() => validateKyberBuild(build(override), allocation, request));
  for (const override of [{ routerAddress: other }, { transactionValue: "1" }, { amountIn: "2000000" }, { amountOut: "0" }, { data: `${build().data}00` }]) assert.throws(() => validateKyberBuild({ ...build(), ...override }, allocation, request));
});
test("quote is read-only; no wallet transaction is submitted", async () => {
  const h = harness();
  const result = await h.route.quote(request);
  assert.equal(result.quotes.length, 1);
  assert.equal(h.sent.length, 0);
});
test("approves exact USDC, rebuilds, simulates, waits and verifies delivery", async () => {
  const h = harness();
  const result = await h.route.execute(h.request);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].params.transaction.to, BASE_USDC_ADDRESS);
  assert.equal(h.sent[1].params.transaction.to, KYBER_ROUTER);
  assert.equal(h.sent[1].caip2, "eip155:8453");
  assert.equal(result.actions[0].action.status, "succeeded");
  assert.equal(result.actions[0].estimatedOutputRaw, "1000");
  assert.equal(h.checkpoints.at(-1).at(-1).stage, "STOCK_DELIVERED");
});
test("narrows a pre-existing unlimited allowance rather than reusing it", async () => {
  const h = harness({ allowance: 2n ** 256n - 1n });
  await h.route.execute(h.request);
  assert.equal(h.sent.length, 3);
  assert.ok(h.checkpoints.some((stages) => stages.at(-1).stage === "RESET_USDC_SUBMITTING"));
});
test("requires durable checkpoint and matching wallet before signing", async () => {
  const h = harness();
  await assert.rejects(h.route.execute(request), /CHECKPOINT/);
  await assert.rejects(h.route.execute({ ...h.request, recipient: other }), /WALLET_MISMATCH/);
  assert.equal(h.sent.length, 0);
});
test("revocation at the durable submission checkpoint prevents signing", async () => {
  const h = harness();
  await assert.rejects(h.route.execute({ ...request, checkpoint: async () => { throw new Error("AUTHORITY_CHANGED"); } }), /AUTHORITY_CHANGED/);
  assert.equal(h.sent.length, 0);
});
test("missing gas and wrong RPC chain fail before any approval", async () => {
  const h = harness({ gasBalance: 0n });
  await assert.rejects(h.route.execute(h.request), /BASE_ETH_REQUIRED/);
  assert.equal(h.sent.length, 0);
  const wrong = harness(); wrong.chain.getChainId = async () => 1;
  await assert.rejects(wrong.route.execute(wrong.request), /RPC_CHAIN_MISMATCH/);
});
test("ambiguous submission, expired build or unverified delivery remains partial", async () => {
  for (const options of [{ rejectSend: true }, { secondBuildFails: true }, { badReceipt: true }, { stale: true }]) {
    const h = harness(options);
    await assert.rejects(h.route.execute(h.request), (error) => { assert.ok(error.partialActions.length > 0); return true; });
  }
});
test("provider failure and duplicate allocations never approve USDC", async () => {
  const h = harness({ noQuote: true });
  await assert.rejects(h.route.execute(h.request), /KYBER_HTTP_429/);
  assert.equal(h.sent.length, 0);
  const duplicated = harness();
  await assert.rejects(duplicated.route.quote({ ...request, allocation: { totalRaw: "2000000", allocations: [allocation, allocation] } }), /DUPLICATE_ALLOCATION/);
});
