import { NextResponse } from "next/server";
import { validateOwnershipRuleCandidate } from "@/lib/ownership-rules";
import { databaseErrorResponse, getLatestOwnershipRule, saveOwnershipRule } from "@/lib/db";
import { assertUserOwnsWallet, authenticatePrivyRequest, authErrorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";

/**
 * Approval is intentionally fail-closed until PostgreSQL and authenticated
 * user identity are provisioned. A rule must never appear saved in memory.
 */
export async function GET(request: Request) {
  try {
    const user = await authenticatePrivyRequest(request);
    const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
    const identity = assertUserOwnsWallet(user, wallet);
    const rule = await getLatestOwnershipRule(identity.userId, identity.walletAddress);
    return NextResponse.json({ rule }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth.status !== 500) return NextResponse.json(auth.body, { status: auth.status });
    const response = databaseErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try {
    const user = await authenticatePrivyRequest(request);
    const value = body && typeof body === "object" ? body as { walletAddress?: unknown; candidate?: unknown } : {};
    const identity = assertUserOwnsWallet(user, String(value.walletAddress ?? ""));
    const validated = validateOwnershipRuleCandidate(value.candidate, identity.walletAddress);
    const rule = await saveOwnershipRule(identity.userId, identity.walletAddress, validated);
    return NextResponse.json({ rule }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth.status !== 500) return NextResponse.json(auth.body, { status: auth.status });
    const response = databaseErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
