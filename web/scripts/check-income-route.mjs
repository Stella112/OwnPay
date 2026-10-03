// Read-only deployment check. Never signs, swaps, approves or buys tokens.
import pg from "pg";
import { PrivyClient } from "@privy-io/node";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const cngn = "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F";
const dpri = "0xc68b460fe4c916Fd17d6ab6b181A409C763002d9";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;
try {
  const rules = await pool.query("select count(*) as count from ownpay_ownership_rules where enabled = true");
  const wallets = await pool.query("select privy_wallet_id from ownpay_agent_authorizations where privy_wallet_id is not null and status = 'ACTIVE' limit 1");
  const cursor = await pool.query("select last_scanned_block from ownpay_agent_cursors where chain_id = 8453 limit 1");
  const chain = createPublicClient({ chain: base, transport: http(process.env.AGENT_RPC_URL || "https://mainnet.base.org", { timeout: 15000 }) });
  const latest = await chain.getBlockNumber();
  console.log(JSON.stringify({ mode: process.env.OWNPAY_AGENT_MODE || "observe", enabledRules: rules.rows[0].count, activeWalletAvailable: !!wallets.rows[0], cursorLagBlocks: cursor.rows[0] ? String(latest - BigInt(cursor.rows[0].last_scanned_block)) : null,
    privyConfigured: !!(appId && process.env.PRIVY_APP_SECRET), signerConfigured: !!process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY }));
  const payout = await chain.readContract({ address: dpri, abi: parseAbi(["function payoutToken() view returns (address)"]), functionName: "payoutToken" });
  console.log(JSON.stringify({ dpriPayoutToken: payout, expectedCngn: payout.toLowerCase() === cngn.toLowerCase() }));
  if (appId && process.env.PRIVY_APP_SECRET) {
    const privy = new PrivyClient({ appId, appSecret: process.env.PRIVY_APP_SECRET });
    try {
      const walletId = wallets.rows[0]?.privy_wallet_id || (await privy.wallets().list({ limit: 1 })).data?.[0]?.id;
      if (!walletId) throw new Error("NO_WALLET_FOR_QUOTE");
      const quote = await privy.wallets().swaps().quote(walletId, {
        base_amount: "1000000", amount_type: "exact_input", slippage_bps: 100,
        source: { asset_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", caip2: "eip155:8453" },
        destination: { asset_address: cngn, caip2: "eip155:8453" },
      });
      console.log(JSON.stringify({ usdcCngnQuote: "AVAILABLE", estimatedOutputRaw: quote.est_output_amount, minimumOutputRaw: quote.minimum_output_amount }));
    } catch (error) {
      // Only provider error code/status; never dump a request containing credentials.
      console.log(JSON.stringify({ usdcCngnQuote: "UNAVAILABLE", httpStatus: error.status ?? null, code: error.error?.code ?? error.code ?? null, providerMessage: String(error.error?.message || error.error?.error || "").slice(0, 300) }));
    }
  }
} finally { await pool.end(); }
