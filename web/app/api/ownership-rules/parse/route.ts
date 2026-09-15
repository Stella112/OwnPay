import { NextResponse } from "next/server";
import { OWNERSHIP_RULE_JSON_SCHEMA, validateOwnershipRuleCandidate } from "@/lib/ownership-rules";
import { authenticatePrivyRequest, authErrorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";

const MAX_INPUT = 1_000;

export async function POST(request: Request) {
  try { await authenticatePrivyRequest(request); } catch (error) { const response = authErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
  const baseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL;
  if (!baseUrl || !model) return NextResponse.json({ error: "Rule parsing is not enabled on this deployment yet." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const instruction = body && typeof body === "object" && "instruction" in body ? String(body.instruction).trim() : "";
  if (!instruction || instruction.length > MAX_INPUT) return NextResponse.json({ error: `Enter a rule between 1 and ${MAX_INPUT} characters.` }, { status: 400 });
  const authorization = process.env.OLLAMA_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) },
      body: JSON.stringify({
        model,
        stream: false,
        format: OWNERSHIP_RULE_JSON_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: "Interpret the user's instruction into the exact JSON schema. The trigger is incoming Base USDC. Verified destinations may be Coinbase B20 assets or DPRI, the verified GetEquity Dangote Petroleum Refinery market asset settled with cNGN on Base. Never invent an address, a route, a wallet permission, or a transaction. Return JSON only." },
          { role: "user", content: instruction },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return NextResponse.json({ error: "The rule interpreter is temporarily unavailable." }, { status: 502 });
    const result = await response.json() as { message?: { content?: string } };
    const content = result.message?.content;
    if (!content) return NextResponse.json({ error: "The rule interpreter returned no rule." }, { status: 502 });
    const candidate = JSON.parse(content);
    const rule = validateOwnershipRuleCandidate(candidate, "0x0000000000000000000000000000000000000000");
    return NextResponse.json({ candidate, rule });
  } catch (cause) {
    if (cause instanceof SyntaxError) return NextResponse.json({ error: "The rule interpreter returned malformed JSON." }, { status: 502 });
    return NextResponse.json({ error: "The rule interpreter could not be reached." }, { status: 502 });
  }
}
