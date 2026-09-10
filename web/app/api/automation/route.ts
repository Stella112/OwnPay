import { NextResponse } from "next/server";
import {
  activateAgentAuthorization,
  databaseErrorResponse,
  getAgentAuthorization,
  revokeAgentAuthorization,
  setAgentAutomationPaused,
} from "@/lib/db";
import {
  assertUserOwnsWallet,
  authenticatePrivyRequest,
  authErrorResponse,
  isPrivyEmbeddedWalletDelegated,
} from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await authenticatePrivyRequest(request);
    const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
    const identity = assertUserOwnsWallet(user, wallet);
    return NextResponse.json({ authorization: await getAgentAuthorization(identity.userId, identity.walletAddress) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("OWNPAY_AUTOMATION_GET_ERROR", error instanceof Error ? error.message : String(error));
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
    const value = body && typeof body === "object" ? body as { walletAddress?: unknown; action?: unknown; privyWalletId?: unknown } : {};
    const identity = assertUserOwnsWallet(user, String(value.walletAddress ?? ""));
    const action = String(value.action ?? "");
    if (action === "activate") {
      if (!isPrivyEmbeddedWalletDelegated(user, identity.walletAddress)) {
        return NextResponse.json({ error: "Privy delegation has not been confirmed yet. Finish the delegation prompt, then try again." }, { status: 409 });
      }
      const authorization = await activateAgentAuthorization(identity.userId, identity.walletAddress, value.privyWalletId ? String(value.privyWalletId) : null);
      return NextResponse.json({ authorization }, { status: 200, headers: { "cache-control": "no-store" } });
    }
    if (action === "pause" || action === "resume") {
      const authorization = await setAgentAutomationPaused(identity.userId, identity.walletAddress, action === "pause");
      if (!authorization) return NextResponse.json({ error: "Agent authority is not active." }, { status: 409 });
      return NextResponse.json({ authorization }, { headers: { "cache-control": "no-store" } });
    }
    if (action === "revoke") {
      const authorization = await revokeAgentAuthorization(identity.userId, identity.walletAddress);
      return NextResponse.json({ authorization }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "Unsupported automation action." }, { status: 400 });
  } catch (error) {
    console.error("OWNPAY_AUTOMATION_POST_ERROR", error instanceof Error ? error.message : String(error));
    const auth = authErrorResponse(error);
    if (auth.status !== 500) return NextResponse.json(auth.body, { status: auth.status });
    const response = databaseErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
