"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { getIdentityToken, useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import type { OwnershipRule, OwnershipRuleCandidate } from "@/lib/ownership-rules";

export function OwnershipRulesPanel() {
  const [instruction, setInstruction] = useState("Put 10% of every payment above $100 into Apple and Nvidia, split evenly.");
  const [candidate, setCandidate] = useState<OwnershipRuleCandidate | null>(null);
  const [rule, setRule] = useState<OwnershipRule | null>(null);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<"idle" | "parsing" | "review" | "saving" | "saved">("idle");
  const { address } = useAccount();
  const { authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();

  async function authHeaders() {
    const token = identityToken ?? await getIdentityToken();
    if (!token) throw new Error("Your sign-in session is still loading. Try again in a moment.");
    return { "content-type": "application/json", "x-privy-id-token": token };
  }

  useEffect(() => {
    if (!authenticated || !address) return;
    let cancelled = false;
    (async () => {
      const token = identityToken ?? await getIdentityToken();
      if (!token || cancelled) return;
      return fetch(`/api/ownership-rules?wallet=${encodeURIComponent(address)}`, { headers: { "x-privy-id-token": token }, cache: "no-store" });
    })()
      .then(async (response) => {
        if (!response) return null;
        if (response.status === 404) return null;
        const body = await response.json() as { error?: string; rule?: OwnershipRule | null };
        if (!response.ok) throw new Error(body.error ?? "Could not load your saved rule.");
        return body.rule ?? null;
      })
      .then((saved) => {
        if (cancelled) return;
        if (!saved) return;
        setRule(saved);
        setCandidate({
          trigger: "incoming_usdc",
          minimum_payment: formatUnits(BigInt(saved.minimumPaymentRaw), 6),
          allocation_percent: String(saved.allocationBps / 100),
          allocations: saved.allocations.map((allocation) => ({ asset: allocation.assetSymbol, weight_percent: String(allocation.weightBps / 100) })),
          max_per_payment: formatUnits(BigInt(saved.maxPerPaymentRaw), 6),
          max_daily: formatUnits(BigInt(saved.maxDailyRaw), 6),
          max_monthly: formatUnits(BigInt(saved.maxMonthlyRaw), 6),
        });
        setStatus("saved");
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your saved rule."); });
    return () => { cancelled = true; };
  }, [address, authenticated, identityToken]);

  async function createRule() {
    setError(undefined);
    setStatus("parsing");
    try {
      const response = await fetch("/api/ownership-rules/parse", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ instruction }) });
      const body = await response.json() as { error?: string; candidate?: OwnershipRuleCandidate; rule?: OwnershipRule };
      if (!response.ok || !body.candidate || !body.rule) throw new Error(body.error ?? "Could not create a rule review.");
      setCandidate(body.candidate);
      setRule(body.rule);
      setStatus("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a rule review.");
      setStatus("idle");
    }
  }

  async function approveRule() {
    if (!rule) return;
    setError(undefined);
    setStatus("saving");
    try {
      if (!address) throw new Error("A signed-in wallet is required.");
      const response = await fetch("/api/ownership-rules", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ walletAddress: address, candidate }) });
      const body = await response.json() as { error?: string; rule?: OwnershipRule };
      if (!response.ok || !body.rule) throw new Error(body.error ?? "Could not save the rule.");
      setRule(body.rule);
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the rule.");
      setStatus("review");
    }
  }

  return <section className="dashboard-section" aria-labelledby="rules-title">
    <div className="section-heading"><div><p className="eyebrow">Programmable ownership</p><h2 id="rules-title">Ownership Rules</h2></div><span className="section-count">User approval required</span></div>
    <div className="panel stack" style={{ ["--gap" as string]: "15px", marginTop: 20 }}>
      <p className="soft" style={{ margin: 0, lineHeight: 1.5 }}>Tell OwnPay what portion of qualifying Base USDC payments should become verified tokenized-stock ownership.</p>
      <label htmlFor="ownership-rule-input">Tell OwnPay your rule</label>
      <textarea id="ownership-rule-input" className="input" rows={3} value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1000} />
      {error && <div className="field-error" role="alert">{error}</div>}
      {!candidate ? <button className="btn btn-primary" onClick={createRule} disabled={!instruction.trim() || status === "parsing"}>{status === "parsing" ? "Interpreting…" : "Create rule review"}</button> : <div className="panel stack" style={{ ["--gap" as string]: "12px", background: "var(--surface-sunken)" }}>
        <h3 style={{ fontSize: 17 }}>Here’s what OwnPay understood</h3>
        <dl className="meta"><dt>When you receive</dt><dd>USDC</dd><dt>Minimum</dt><dd>${candidate.minimum_payment}</dd><dt>Ownership</dt><dd>{candidate.allocation_percent}%</dd><dt>Allocation</dt><dd>{candidate.allocations.map((allocation) => `${allocation.asset} ${allocation.weight_percent}%`).join(" · ")}</dd><dt>Max per payment</dt><dd>${candidate.max_per_payment}</dd><dt>Max per month</dt><dd>${candidate.max_monthly}</dd></dl>
        <p className="field-hint">No automation starts from this review. Approval saves the validated integer rule in PostgreSQL; it does not grant transaction authority.</p>
        {status === "saved" && <div className="pill pill-accent" style={{ alignSelf: "flex-start" }}><span className="dot" /> Saved · automation paused</div>}
        <div className="row"><button className="btn btn-ghost" onClick={() => { setCandidate(null); setRule(null); setStatus("idle"); }}>Edit</button>{status !== "saved" && <button className="btn btn-primary" onClick={approveRule} disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Approve rule"}</button>}</div>
      </div>}
    </div>
  </section>;
}
