import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  VERIFIED_B20,
  AutomationUnavailableError,
  createB20UsdcRoute,
  validateRouteRequest,
} from "./b20-usdc-route.mjs";

const recipient = "0x0000000000000000000000000000000000000001";

function request(overrides = {}) {
  return {
    chainId: BASE_CHAIN_ID,
  usdcAddress: BASE_USDC_ADDRESS,
  recipient,
    walletId: "wallet-test-1",
    idempotencyKey: "event-test-000000000000000000000000",
    slippageBps: 100,
    allocation: {
      totalRaw: "100",
      allocations: [{ assetSymbol: "AAPLc", assetAddress: VERIFIED_B20.AAPLc, amountRaw: "100" }],
    },
    ...overrides,
  };
}

test("accepts a canonical Base USDC plan with an official B20 asset", () => {
  const normalized = validateRouteRequest(request());
  assert.equal(normalized.chainId, 8453);
  assert.equal(normalized.allocation.allocations[0].assetAddress, VERIFIED_B20.AAPLc);
});

test("rejects a non-Base chain or non-canonical USDC", () => {
  assert.throws(() => validateRouteRequest(request({ chainId: 84532 })), /INVALID_ROUTE_CHAIN/);
  assert.throws(() => validateRouteRequest(request({ usdcAddress: recipient })), /INVALID_ROUTE_USDC/);
});

test("rejects unknown assets, mismatched addresses, and allocation totals", () => {
  assert.throws(
    () => validateRouteRequest(request({ allocation: { totalRaw: "100", allocations: [{ assetSymbol: "FAKE", assetAddress: recipient, amountRaw: "100" }] } })),
    /UNSUPPORTED_ROUTE_ASSET/,
  );
  assert.throws(
    () => validateRouteRequest(request({ allocation: { totalRaw: "100", allocations: [{ assetSymbol: "AAPLc", assetAddress: recipient, amountRaw: "100" }] } })),
    /UNSUPPORTED_ROUTE_ASSET/,
  );
  assert.throws(
    () => validateRouteRequest(request({ allocation: { totalRaw: "101", allocations: [{ assetSymbol: "AAPLc", assetAddress: VERIFIED_B20.AAPLc, amountRaw: "100" }] } })),
    /INVALID_ROUTE_ALLOCATION_TOTAL/,
  );
});

test("route never executes while venue and signer controls are not verified", async () => {
  const route = createB20UsdcRoute();
  assert.equal(route.status.enabled, false);
  await assert.rejects(route.execute(request()), (error) => {
    assert.ok(error instanceof AutomationUnavailableError);
    assert.equal(error.code, "AUTOMATION_UNAVAILABLE");
    return true;
  });
});

test("enabled route quotes and executes only through the injected Privy swap service", async () => {
  const previous = {
    enabled: process.env.OWNPAY_B20_ROUTE_ENABLED,
    venue: process.env.OWNPAY_B20_VENUE,
    appId: process.env.PRIVY_APP_ID,
    secret: process.env.PRIVY_APP_SECRET,
    key: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
  };
  process.env.OWNPAY_B20_ROUTE_ENABLED = "true";
  process.env.OWNPAY_B20_VENUE = "privy-uniswap";
  process.env.PRIVY_APP_ID = "app-test";
  process.env.PRIVY_APP_SECRET = "secret-test";
  process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "key-test";
  const calls = [];
  const fakeClient = {
    wallets() {
      return {
        swaps() {
          return {
            async quote(walletId, params) {
              calls.push(["quote", walletId, params]);
              return { est_output_amount: "90", minimum_output_amount: "89" };
            },
            async execute(walletId, params) {
              calls.push(["execute", walletId, params]);
              return { id: "action-1", steps: [{ type: "evm_transaction", transaction_hash: "0xabc" }] };
            },
          };
        },
      };
    },
  };
  try {
    const route = createB20UsdcRoute({ privyClient: fakeClient });
    assert.equal(route.status.enabled, true);
    const quoted = await route.quote(request());
    assert.equal(quoted.quotes[0].estimatedOutputRaw, "90");
    const executed = await route.execute(request());
    assert.equal(executed.actions[0].transactionHashes[0], "0xabc");
    assert.equal(calls.filter(([kind]) => kind === "execute").length, 1);
    assert.equal(calls.find(([kind]) => kind === "execute")[2].authorization_context.authorization_private_keys[0], "key-test");
  } finally {
    for (const [name, value] of Object.entries({
      OWNPAY_B20_ROUTE_ENABLED: previous.enabled,
      OWNPAY_B20_VENUE: previous.venue,
      PRIVY_APP_ID: previous.appId,
      PRIVY_APP_SECRET: previous.secret,
      PRIVY_AUTHORIZATION_PRIVATE_KEY: previous.key,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
