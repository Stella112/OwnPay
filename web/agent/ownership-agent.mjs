import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPublicClient, http, parseAbiItem } from "viem";
import { createB20UsdcRoute } from "./routes/b20-usdc-route.mjs";

const { Pool } = pg;
const BASE_CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DPRI = "0xc68b460fe4c916Fd17d6ab6b181A409C763002d9".toLowerCase();
const VERIFIED_B20 = new Map([
  ["AAPLc", "0xb200000000000000000000C2e324d24d7eEcd1fb".toLowerCase()],
  ["NVDAc", "0xb20000000000000000000078ee7ce2fE4908108C".toLowerCase()],
  ["METAc", "0xb2000000000000000000008bC8786B856E61707C".toLowerCase()],
  ["GOOGLc", "0xb2000000000000000000002D0BA3164cc74f58B7".toLowerCase()],
  ["AMZNc", "0xb200000000000000000000d9192b6B456483C2E8".toLowerCase()],
  ["MSFTc", "0xB200000000000000000000Ab99cFa739E253872B".toLowerCase()],
  ["MSTRc", "0xb2000000000000000000004884b426556b92883d".toLowerCase()],
  ["SNDKc", "0xb200000000000000000000397293Cb8cda9a10c5".toLowerCase()],
  ["SPCXc", "0xb2000000000000000000007b9fcbd005511aCBd5".toLowerCase()],
  ["TSLAc", "0xb2000000000000000000001e800a7f5189430cD0".toLowerCase()],
]);
const VERIFIED_AUTOMATION_ASSETS = new Map([...VERIFIED_B20, ["DPRI", DPRI]]);
const BPS = 10_000n;
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const config = {
  rpcUrl: process.env.AGENT_RPC_URL || "https://mainnet.base.org",
  chainId: Number(process.env.AGENT_CHAIN_ID || BASE_CHAIN_ID),
  usdcAddress: (process.env.AGENT_USDC_ADDRESS || BASE_USDC).toLowerCase(),
  startBlock: process.env.AGENT_START_BLOCK ? BigInt(process.env.AGENT_START_BLOCK) : null,
  // Public Base RPCs may reject a USDC log query that returns too many rows.
  // Keep the default conservative; operators can raise it only after observing
  // their chosen RPC's response-size limits.
  // Base public RPCs can reject USDC log queries that are too large. Keep the
  // default conservative; operators can raise it only after observing their
  // chosen RPC's response-size limits.
  chunkSize: BigInt(process.env.AGENT_BLOCK_CHUNK || "10"),
  pollMs: Number(process.env.AGENT_POLL_INTERVAL_MS || "30000"),
  mode: process.env.OWNPAY_AGENT_MODE || "observe",
};
const route = createB20UsdcRoute();

function assertSafeConfig() {
  if (config.chainId !== BASE_CHAIN_ID) throw new Error("AGENT_CHAIN_ID must be Base mainnet (8453).");
  if (config.usdcAddress !== BASE_USDC.toLowerCase()) throw new Error("Agent trigger asset must be canonical Base USDC.");
  if (!Number.isSafeInteger(config.pollMs) || config.pollMs < 5_000) throw new Error("AGENT_POLL_INTERVAL_MS must be at least 5000.");
  if (config.chunkSize <= 0n || config.chunkSize > 10_000n) throw new Error("AGENT_BLOCK_CHUNK must be between 1 and 10000.");
}

function requiredDatabaseUrl() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the Ownership Agent.");
  return process.env.DATABASE_URL;
}

function eventId(log) {
  return `${config.chainId}:${log.transactionHash}:${log.logIndex}`;
}

function calculateAllocation(paymentRaw, rule) {
  const allocationBps = BigInt(rule.allocation_bps);
  const maxPerPayment = BigInt(rule.max_per_payment_raw);
  const requested = (paymentRaw * allocationBps) / BPS;
  const total = requested > maxPerPayment ? maxPerPayment : requested;
  const allocations = Array.isArray(rule.allocations) ? rule.allocations : [];
  if (total <= 0n || allocations.length === 0) throw new Error("INVALID_ALLOCATION");
  const totalWeight = allocations.reduce((sum, allocation) => sum + BigInt(allocation?.weightBps ?? 0), 0n);
  if (totalWeight !== BPS) throw new Error("INVALID_ALLOCATION_WEIGHTS");

  let remaining = total;
  const plan = allocations.map((allocation, index) => {
    const symbol = String(allocation?.assetSymbol || "");
    const address = VERIFIED_AUTOMATION_ASSETS.get(symbol);
    const weight = BigInt(allocation?.weightBps ?? 0);
    if (!address || weight <= 0n || weight > BPS) throw new Error("UNSUPPORTED_AUTOMATION_ASSET");
    const amount = index === allocations.length - 1 ? remaining : (total * weight) / BPS;
    remaining -= amount;
    return { assetSymbol: symbol, assetAddress: address, weightBps: Number(weight), amountRaw: amount.toString() };
  });
  if (remaining !== 0n) throw new Error("INVALID_ALLOCATION_WEIGHTS");
  return { totalRaw: total.toString(), allocations: plan };
}

async function getCursor(pool) {
  const result = await pool.query(
    "select last_scanned_block from ownpay_agent_cursors where chain_id = $1 and asset_address = $2",
    [config.chainId, config.usdcAddress],
  );
  return result.rows[0] ? BigInt(result.rows[0].last_scanned_block) : null;
}

async function saveCursor(pool, block) {
  await pool.query(
    `insert into ownpay_agent_cursors (chain_id, asset_address, last_scanned_block)
     values ($1, $2, $3)
     on conflict (chain_id, asset_address) do update set last_scanned_block = excluded.last_scanned_block, updated_at = now()`,
    [config.chainId, config.usdcAddress, block.toString()],
  );
}

async function getAgentAuthority(pool, walletAddress) {
  const result = await pool.query(
    `select status, automation_paused, privy_delegated, privy_wallet_id
     from ownpay_agent_authorizations where lower(wallet_address) = $1 limit 1`,
    [walletAddress],
  );
  return result.rows[0] || null;
}

async function processPayment(pool, log) {
  const id = eventId(log);
  const recipient = String(log.args?.to || "").toLowerCase();
  const amountRaw = BigInt(log.args?.value || 0n);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into ownpay_payment_events (event_id, chain_id, transaction_hash, log_index, recipient, amount_raw, status)
       values ($1, $2, $3, $4, $5, $6, 'DETECTED')
       on conflict (chain_id, transaction_hash, log_index) do nothing
       returning event_id`,
      [id, config.chainId, log.transactionHash, Number(log.logIndex), recipient, amountRaw.toString()],
    );
    if (inserted.rowCount === 0) {
      await client.query("rollback");
      return "DUPLICATE";
    }

    const ruleResult = await client.query(
      `select * from ownpay_ownership_rules
       where lower(wallet_address) = $1
       order by version desc limit 1`,
      [recipient],
    );
    const rule = ruleResult.rows[0];
    if (!rule || !rule.enabled) {
      await client.query("update ownpay_payment_events set status = 'SKIPPED' where event_id = $1", [id]);
      await client.query("commit");
      return "SKIPPED";
    }

    if (amountRaw < BigInt(rule.minimum_payment_raw)) {
      await client.query("update ownpay_payment_events set status = 'SKIPPED' where event_id = $1", [id]);
      await client.query("commit");
      return "SKIPPED_BELOW_MINIMUM";
    }

    const authority = await getAgentAuthority(client, recipient);
    let authorityError = null;
    if (!authority || authority.status !== "ACTIVE" || authority.privy_delegated !== true) authorityError = "AGENT_AUTHORITY_NOT_CONFIGURED";
    else if (authority.automation_paused) authorityError = "AUTOMATION_PAUSED";
    else if (!authority.privy_wallet_id) authorityError = "AGENT_WALLET_NOT_CONFIGURED";

    const allocation = calculateAllocation(amountRaw, rule);
    const daily = await client.query(
      `select coalesce(sum(allocation_raw), 0) as total from ownpay_execution_receipts
       where rule_id = $1 and status in ('ELIGIBLE', 'QUOTING', 'EXECUTING', 'CONFIRMED')
       and created_at >= now() - interval '1 day'`,
      [rule.id],
    );
    const monthly = await client.query(
      `select coalesce(sum(allocation_raw), 0) as total from ownpay_execution_receipts
       where rule_id = $1 and status in ('ELIGIBLE', 'QUOTING', 'EXECUTING', 'CONFIRMED')
       and created_at >= now() - interval '30 days'`,
      [rule.id],
    );
    const dailyTotal = BigInt(daily.rows[0].total);
    const monthlyTotal = BigInt(monthly.rows[0].total);
    let errorCode = null;
    if (dailyTotal + BigInt(allocation.totalRaw) > BigInt(rule.max_daily_raw)) errorCode = "DAILY_LIMIT";
    if (monthlyTotal + BigInt(allocation.totalRaw) > BigInt(rule.max_monthly_raw)) errorCode = "MONTHLY_LIMIT";
    if (!errorCode && authorityError) errorCode = authorityError;
    if (!errorCode && config.mode !== "execute") errorCode = "AGENT_OBSERVE_MODE";
    if (!errorCode && allocation.allocations.some((item) => item.assetSymbol === "DPRI")) errorCode = "GETEQUITY_ROUTE_NOT_CONFIGURED";
    if (!errorCode && !route.status.enabled) errorCode = route.status.reason;

    const receiptId = randomUUID();
    await client.query(
      `insert into ownpay_execution_receipts
        (id, event_id, rule_id, rule_version, status, error_code, allocation_raw, allocation)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (event_id) do nothing`,
      [receiptId, id, rule.id, rule.version, errorCode ? "BLOCKED" : "ELIGIBLE", errorCode, allocation.totalRaw, JSON.stringify(allocation)],
    );
    await client.query(`update ownpay_payment_events set status = $2 where event_id = $1`, [id, errorCode ? "BLOCKED" : "ELIGIBLE"]);
    await client.query("commit");

    if (errorCode) return `BLOCKED:${errorCode}`;

    let execution;
    try {
      execution = await route.execute({
        chainId: config.chainId,
        usdcAddress: config.usdcAddress,
        recipient,
        slippageBps: Number(rule.slippage_bps || 0),
        walletId: authority.privy_wallet_id,
        idempotencyKey: id,
        allocation,
      });
    } catch (error) {
      const partialActions = Array.isArray(error?.partialActions) ? error.partialActions : [];
      const partialHashes = partialActions.flatMap((action) => Array.isArray(action.transactionHashes) ? action.transactionHashes : []);
      const partialData = JSON.stringify({ executions: partialActions.map((action) => ({ assetSymbol: action.assetSymbol, actionId: action.action?.id ?? null, status: action.action?.status ?? null, transactionHashes: action.transactionHashes })) });
      await pool.query(
        `update ownpay_execution_receipts set status = $2, error_code = $3, transaction_hash = $4, allocation = coalesce(allocation, '{}'::jsonb) || $5::jsonb, updated_at = now()
         where id = $1`,
        [receiptId, partialActions.length ? "PARTIAL" : "BLOCKED", "ROUTE_EXECUTION_FAILED", partialHashes[0] ?? null, partialData],
      );
      await pool.query("update ownpay_payment_events set status = $2 where event_id = $1", [id, partialActions.length ? "PARTIAL" : "BLOCKED"]);
      return partialActions.length ? "PARTIAL:ROUTE_EXECUTION_FAILED" : "BLOCKED:ROUTE_EXECUTION_FAILED";
    }

    const executions = execution.actions.map((action) => ({
      assetSymbol: action.assetSymbol,
      actionId: action.action?.id ?? null,
      status: action.action?.status ?? null,
      transactionHashes: action.transactionHashes,
      estimatedOutputRaw: action.estimatedOutputRaw,
      minimumOutputRaw: action.minimumOutputRaw,
    }));
    const transactionHashes = executions.flatMap((action) => action.transactionHashes);
    const allConfirmed = executions.length > 0 && executions.every((action) => action.status === "confirmed");
    const executionStatus = allConfirmed ? "CONFIRMED" : "EXECUTING";
    await pool.query(
      `update ownpay_execution_receipts set status = $2, error_code = null, transaction_hash = $3, allocation = coalesce(allocation, '{}'::jsonb) || $4::jsonb, updated_at = now()
       where id = $1`,
      [receiptId, executionStatus, transactionHashes[0] ?? null, JSON.stringify({ executions })],
    );
    await pool.query("update ownpay_payment_events set status = $2 where event_id = $1", [id, executionStatus]);
    return `${executionStatus}:${executions.length}`;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function scanOnce(pool, publicClient) {
  const latest = await publicClient.getBlockNumber();
  const cursor = await getCursor(pool);
  const fromBlock = cursor === null ? (config.startBlock ?? latest) : cursor + 1n;
  if (fromBlock > latest) return { fromBlock, toBlock: latest, processed: 0 };
  const toBlock = fromBlock + config.chunkSize - 1n > latest ? latest : fromBlock + config.chunkSize - 1n;
  const logs = await publicClient.getLogs({ address: config.usdcAddress, event: transferEvent, fromBlock, toBlock });
  let processed = 0;
  for (const log of logs) {
    if (!log.args?.to || !log.transactionHash || log.logIndex === undefined) continue;
    const result = await processPayment(pool, log);
    if (result !== "DUPLICATE") processed += 1;
    console.log(`OWNPAY_AGENT_EVENT ${eventId(log)} ${result}`);
  }
  await saveCursor(pool, toBlock);
  return { fromBlock, toBlock, processed };
}

async function main() {
  assertSafeConfig();
  const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 2, connectionTimeoutMillis: 5_000 });
  const publicClient = createPublicClient({ chain: { id: BASE_CHAIN_ID, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } }, transport: http(config.rpcUrl) });
  console.log(`OWNPAY_AGENT_READY chain=${config.chainId} asset=${BASE_USDC} mode=${config.mode} authority=guarded route=${route.status.reason}`);
  try {
    await pool.query("select 1");
    const once = process.argv.includes("--once");
    do {
      const result = await scanOnce(pool, publicClient);
      console.log(`OWNPAY_AGENT_SCAN from=${result.fromBlock} to=${result.toBlock} processed=${result.processed}`);
      if (!once) await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    } while (!once);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`OWNPAY_AGENT_FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
