import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Approval is intentionally fail-closed until PostgreSQL and authenticated
 * user identity are provisioned. A rule must never appear saved in memory.
 */
export async function POST() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Durable Ownership Rules storage is not configured on this deployment yet." }, { status: 503 });
  return NextResponse.json({ error: "Database adapter is not enabled until authenticated user identity is configured." }, { status: 503 });
}
