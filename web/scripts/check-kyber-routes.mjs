// READ ONLY: builds and validates unsigned routes. No wallet signing or sending.
import { createKyberB20Route } from "../agent/routes/kyber-b20-route.mjs";
import { BASE_USDC_ADDRESS, VERIFIED_B20 } from "../agent/routes/b20-usdc-route.mjs";
const route = createKyberB20Route({ enabled: true, privyClient: {} });
let failures = 0;
for (const [assetSymbol, assetAddress] of Object.entries(VERIFIED_B20)) {
  try {
    const { quotes } = await route.quote({ chainId: 8453, usdcAddress: BASE_USDC_ADDRESS, recipient: "0x0000000000000000000000000000000000000001", walletId: "read-only", slippageBps: 100, allocation: { totalRaw: "10000000", allocations: [{ assetSymbol, assetAddress, amountRaw: "10000000" }] } });
    console.log(JSON.stringify({ stock: assetSymbol, validated: true, outputRaw: quotes[0].estimatedOutputRaw, minimumRaw: quotes[0].minimumOutputRaw }));
  } catch (error) { failures++; console.log(JSON.stringify({ stock: assetSymbol, validated: false, error: error.message })); }
}
process.exitCode = failures ? 1 : 0;
