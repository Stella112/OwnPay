import { Pool, type PoolClient } from "pg";
import type { OwnershipRule } from "@/lib/ownership-rules";

declare global {
  var ownpayPool: Pool | undefined;
}

export class DatabaseConfigurationError extends Error {}

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseConfigurationError("Durable Ownership Rules storage is not configured on this deployment yet.");
  if (!globalThis.ownpayPool) {
    globalThis.ownpayPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.ownpayPool;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapRule(row: Record<string, unknown>): OwnershipRule {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    walletAddress: String(row.wallet_address),
    enabled: Boolean(row.enabled),
    triggerAsset: "USDC",
    triggerAssetAddress: String(row.trigger_asset_address),
    minimumPaymentRaw: String(row.minimum_payment_raw),
    allocationBps: Number(row.allocation_bps),
    allocations: row.allocations as OwnershipRule["allocations"],
    maxPerPaymentRaw: String(row.max_per_payment_raw),
    maxDailyRaw: String(row.max_daily_raw),
    maxMonthlyRaw: String(row.max_monthly_raw),
    slippageBps: Number(row.slippage_bps),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getLatestOwnershipRule(userId: string, walletAddress: string) {
  const result = await getPool().query(
    "select * from ownpay_ownership_rules where user_id = $1 and wallet_address = $2 order by version desc limit 1",
    [userId, walletAddress],
  );
  return result.rows[0] ? mapRule(result.rows[0]) : null;
}

export async function saveOwnershipRule(userId: string, walletAddress: string, rule: Omit<OwnershipRule, "id" | "userId" | "createdAt" | "updatedAt" | "version">) {
  return inTransaction(async (client) => {
    await client.query("insert into ownpay_users (id, wallet_address) values ($1, $2) on conflict (id) do update set wallet_address = excluded.wallet_address, updated_at = now()", [userId, walletAddress]);
    // Serialize versions per Privy user so concurrent approvals cannot create duplicates.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [userId]);
    const versionResult = await client.query("select coalesce(max(version), 0) + 1 as version from ownpay_ownership_rules where user_id = $1", [userId]);
    const version = Number(versionResult.rows[0].version);
    const id = crypto.randomUUID();
    const result = await client.query(
      `insert into ownpay_ownership_rules
        (id, user_id, wallet_address, version, enabled, trigger_asset, trigger_asset_address, minimum_payment_raw, allocation_bps, allocations, max_per_payment_raw, max_daily_raw, max_monthly_raw, slippage_bps)
       values ($1, $2, $3, $4, false, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       returning *`,
      [id, userId, walletAddress, version, rule.triggerAsset, rule.triggerAssetAddress, rule.minimumPaymentRaw, rule.allocationBps, JSON.stringify(rule.allocations), rule.maxPerPaymentRaw, rule.maxDailyRaw, rule.maxMonthlyRaw, rule.slippageBps],
    );
    return mapRule(result.rows[0]);
  });
}

export function databaseErrorResponse(error: unknown) {
  if (error instanceof DatabaseConfigurationError) return { status: 503, body: { error: error.message } };
  return { status: 503, body: { error: "Durable Ownership Rules storage is temporarily unavailable." } };
}
