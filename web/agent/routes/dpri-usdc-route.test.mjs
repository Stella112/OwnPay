import test from "node:test";
import assert from "node:assert/strict";
import { createDpriUsdcRoute, validateDpriRequest, affordableDpri, DPRI, CNGN } from "./dpri-usdc-route.mjs";
import { BASE_USDC_ADDRESS } from "./b20-usdc-route.mjs";

const recipient = "0x0000000000000000000000000000000000000001";
const request = { chainId: 8453, usdcAddress: BASE_USDC_ADDRESS, recipient, walletId: "wallet-test", idempotencyKey: "8453:income:1", slippageBps: 0, allocation: { totalRaw: "1000000", allocations: [{ assetSymbol: "DPRI", assetAddress: DPRI, amountRaw: "1000000" }] } };
test("DPRI validation pins token, chain, recipient and integer USDC budget", () => {
  assert.equal(validateDpriRequest(request).allocation.allocations[0].assetAddress, DPRI);
  assert.throws(() => validateDpriRequest({ ...request, chainId: 1 }), /INVALID_ROUTE_CHAIN/);
  assert.throws(() => validateDpriRequest({ ...request, idempotencyKey: "" }), /DPRI_EVENT_ID_REQUIRED/);
  assert.throws(() => validateDpriRequest({ ...request, allocation: { ...request.allocation, allocations: [{ ...request.allocation.allocations[0], assetAddress: recipient }] } }), /INVALID_DPRI_ALLOCATION/);
});
test("integer fractional purchase never guesses the FX or price", () => {
  assert.equal(affordableDpri(530250000n, 530250000n), 10n ** 18n);
  assert.equal(affordableDpri(530250n, 530250000n), 10n ** 15n);
  assert.throws(() => affordableDpri(0n, 10n), /INVALID_MARKET_QUOTE/);
});
test("disabled route and missing durable checkpoint cannot spend", async () => {
  const route = createDpriUsdcRoute({ enabled: false });
  await assert.rejects(route.quote(request), /GETEQUITY_ROUTE_NOT_CONFIGURED/);
  await assert.rejects(route.execute(request), /DPRI_DURABLE_CHECKPOINT_REQUIRED/);
});
test("a blocked Privy quote never submits a swap or an approval", async () => {
  let signed = 0;
  const privyClient = { wallets: () => ({
    get: async () => ({ address: recipient, chain_type: "ethereum" }),
    swaps: () => ({ quote: async () => { throw Object.assign(new Error("disabled"), { status: 403 }); }, execute: async () => { signed++; } }),
  }) };
  const route = createDpriUsdcRoute({ enabled: true, privyClient });
  await assert.rejects(route.execute({ ...request, checkpoint: async () => {} }), /PRIVY_SWAPS_NOT_ENABLED/);
  assert.equal(signed, 0);
});
test("wallet ID cannot redirect purchases to another wallet", async () => {
  const route = createDpriUsdcRoute({ enabled: true, privyClient: { wallets: () => ({ get: async () => ({ address: CNGN, chain_type: "ethereum" }) }) } });
  await assert.rejects(route.quote(request), /DPRI_WALLET_RECIPIENT_MISMATCH/);
});

function purchaseFixture({ failBuy = false, pending = false } = {}) {
  const writes = [], stages = [];
  const amount = 10n ** 18n;
  const publicClient = {
    getStorageAt: async () => "0x0000000000000000000000001d73b31832240aaf0181b2e6e27f5a01c94f5ec5",
    readContract: async ({ functionName }) => {
      if (functionName === "payoutToken") return CNGN;
      if (functionName === "getAsset") return { token: DPRI, vault: recipient, isActive: true, tokenDecimals: 18 };
      if (functionName === "calculateBuyCost") return [525000000n, 5250000n, 530250000n];
      if (functionName === "balanceOf") return amount * 100n;
      if (functionName === "allowance") return 0n;
      throw new Error(functionName);
    },
    simulateContract: async ({ functionName }) => { if (failBuy && functionName === "buy") throw new Error("BUY_SIMULATION_FAILED"); },
    waitForTransactionReceipt: async ({ hash }) => ({ status: "success", logs: hash === "0xbuy" ? [{ address: DPRI, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0", `0x${recipient.slice(2).padStart(64, "0")}`], data: `0x${amount.toString(16)}` }] : [] }),
  };
  const action = { id: "swap", status: pending ? "pending" : "succeeded", output_amount: "530250000", output_token: CNGN, steps: [] };
  const privyClient = { wallets: () => ({ get: async () => ({ address: recipient, chain_type: "ethereum" }),
    swaps: () => ({ quote: async () => ({ minimum_output_amount: "530250000" }), execute: async (_wallet, params) => { writes.push(["swap", params]); return action; } }),
    actions: { get: async () => action },
    ethereum: () => ({ sendTransaction: async (_wallet, params) => { writes.push(["tx", params]); return { hash: writes.length === 2 ? "0xapprove" : "0xbuy" }; } }),
  }) };
  return { route: createDpriUsdcRoute({ enabled: true, publicClient, privyClient, wait: async () => {} }), writes, stages, input: { ...request, checkpoint: async (next) => stages.push(next.at(-1).stage) } };
}
test("confirmed route persists phases, approves exact cost and verifies delivery", async () => {
  const { route, writes, stages, input } = purchaseFixture();
  const result = await route.execute(input);
  assert.equal(result.actions[0].action.status, "succeeded");
  assert.equal(result.actions[0].estimatedOutputRaw, String(10n ** 18n));
  assert.equal(writes.length, 3);
  assert.equal(writes[0][1].slippage_bps, 0);
  assert.ok(stages.indexOf("SWAP_SUBMITTING") < stages.indexOf("SWAP_SUBMITTED"));
  assert.equal(stages.at(-1), "DPRI_CONFIRMED");
});
test("unconfirmed swap never approves or buys", async () => {
  const { route, writes, input } = purchaseFixture({ pending: true });
  await assert.rejects(route.execute(input), /CNGN_SWAP_NOT_CONFIRMED/);
  assert.equal(writes.length, 1);
});
test("purchase simulation failure preserves partial state without a second swap", async () => {
  const { route, writes, input } = purchaseFixture({ failBuy: true });
  await assert.rejects(route.execute(input), (error) => error.message === "BUY_SIMULATION_FAILED" && error.partialActions.length === 1);
  assert.equal(writes.filter(([kind]) => kind === "swap").length, 1);
  assert.equal(writes.length, 2);
});
