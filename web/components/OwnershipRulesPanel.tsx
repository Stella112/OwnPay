"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { getEmbeddedConnectedWallet, getIdentityToken, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import type { OwnershipRule, OwnershipRuleCandidate } from "@/lib/ownership-rules";
import { validateOwnershipRuleCandidate } from "@/lib/ownership-rules";
import { SUPPORTED_TOKENS } from "@/lib/tokens";
import { DPRI_MARKET_URL } from "@/lib/market-assets";

export function OwnershipRulesPanel() {
  const [instruction, setInstruction] = useState("Turn 10% of every incoming Base USDC payment above $100 into Apple and Nvidia, split evenly.");
  const [manual, setManual] = useState(false);
  const [manualAsset, setManualAsset] = useState("NVDAc");
  const [percent, setPercent] = useState("10");
  const [minimum, setMinimum] = useState("1");
  const [perPayment, setPerPayment] = useState("10");
  const [daily, setDaily] = useState("20");
  const [monthly, setMonthly] = useState("100");
  const [slippage, setSlippage] = useState("1");
  const [candidate, setCandidate] = useState<OwnershipRuleCandidate | null>(null);
  const [rule, setRule] = useState<OwnershipRule | null>(null);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<"idle" | "parsing" | "review" | "saving" | "saved">("idle");
  const { address: connectedAddress } = useAccount();
  const { wallets } = useWallets();
  const address = getEmbeddedConnectedWallet(wallets)?.address ?? connectedAddress;
  const { authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();

  async function authHeaders() {
    const token = await getIdentityToken() ?? identityToken;
    if (!token) throw new Error("Your sign-in session is still loading. Try again in a moment.");
    return { "content-type": "application/json", "x-privy-id-token": token };
  }

  useEffect(() => {
    // Wallet changes must immediately discard another wallet's review/approval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRule(null); setCandidate(null); setStatus("idle"); setError(undefined);
    if (!authenticated || !address) return;
    let cancelled = false;
    (async () => {
      const token = await getIdentityToken();
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
          slippage_bps: saved.slippageBps,
        });
        setStatus("saved");
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your saved rule."); });
    return () => { cancelled = true; };
  }, [address, authenticated]);

  async function createRule() {
    setError(undefined);
    setStatus("parsing");
    try {
      const response = await fetch("/api/ownership-rules/parse", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ instruction }) });
      const body = await response.json() as { error?: string; candidate?: OwnershipRuleCandidate; rule?: OwnershipRule };
      if (!response.ok || !body.candidate || !body.rule) throw new Error(body.error ?? "Could not create a rule review.");
      const reviewedCandidate = { ...body.candidate, slippage_bps: body.candidate.slippage_bps ?? 100 };
      setCandidate(reviewedCandidate);
      setRule({ ...body.rule, slippageBps: reviewedCandidate.slippage_bps });
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
      <p className="soft" style={{ margin: 0, lineHeight: 1.5 }}>Choose how much of new Base USDC income to convert into eligible tokenized stocks. Purchases go to this rule’s wallet. Base ETH is required for gas; saving a rule does not move funds.</p>
      <div className="row"><button className="btn btn-ghost" onClick={() => { setManual(!manual); setCandidate(null); setRule(null); setStatus("idle"); }}>{manual ? "Use natural language" : "Set up a stock rule manually"}</button></div>
      {!manual ? <><label htmlFor="ownership-rule-input">Tell OwnPay your rule</label><textarea id="ownership-rule-input" className="input" rows={3} value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1000} /></> : <>
        <label htmlFor="rule-stock">Stock</label><select id="rule-stock" className="input" value={manualAsset} onChange={(event) => setManualAsset(event.target.value)}>{SUPPORTED_TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}</select>
        {[["Income allocation (%)", percent, setPercent], ["Minimum incoming USDC", minimum, setMinimum], ["Maximum USDC per payment", perPayment, setPerPayment], ["Maximum USDC per day", daily, setDaily], ["Maximum USDC per month", monthly, setMonthly], ["Maximum slippage (%)", slippage, setSlippage]].map(([label, value, setter], index) => <label key={index}>{String(label)}<input className="input" inputMode="decimal" value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)} /></label>)}
      </>}
      {error && <div className="field-error" role="alert">{error}</div>}
      {!candidate ? <button className="btn btn-primary" onClick={() => { if (!manual) { void createRule(); return; } try { if (!/^\d+(?:\.\d{1,2})?$/.test(slippage)) throw new Error("Enter slippage with at most two decimal places."); const next: OwnershipRuleCandidate = { trigger: "incoming_usdc", minimum_payment: minimum, allocation_percent: percent, allocations: [{ asset: manualAsset, weight_percent: "100" }], max_per_payment: perPayment, max_daily: daily, max_monthly: monthly, slippage_bps: Math.round(Number(slippage) * 100) }; const validated = validateOwnershipRuleCandidate(next, address ?? "0x0000000000000000000000000000000000000000"); setCandidate(next); setRule({ ...validated, id: "", userId: "", createdAt: "", updatedAt: "" }); setError(undefined); setStatus("review"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check your rule values."); } }} disabled={!authenticated || status === "parsing"}>{status === "parsing" ? "Interpreting…" : "Create rule review"}</button> : <div className="panel stack" style={{ ["--gap" as string]: "12px", background: "var(--surface-sunken)" }}>
        <h3 style={{ fontSize: 17 }}>Here’s what OwnPay understood</h3>
        <dl className="meta"><dt>Rule wallet</dt><dd style={{ overflowWrap: "anywhere" }}>{address}</dd><dt>When you receive</dt><dd>USDC</dd><dt>Minimum</dt><dd>${candidate.minimum_payment}</dd><dt>Ownership</dt><dd>{candidate.allocation_percent}%</dd><dt>Allocation</dt><dd>{candidate.allocations.map((allocation) => `${allocation.asset} ${allocation.weight_percent}%`).join(" · ")}</dd><dt>Max per payment</dt><dd>${candidate.max_per_payment}</dd><dt>Max per day</dt><dd>${candidate.max_daily ?? candidate.max_per_payment}</dd><dt>Max per month</dt><dd>${candidate.max_monthly}</dd><dt>Maximum slippage</dt><dd>{(candidate.slippage_bps ?? 0) / 100}%</dd></dl>
        <p className="field-hint">Approve the limits shown here, grant agent access, then resume automation above. Only new qualifying USDC received by this rule’s wallet triggers purchases. Existing balances are not automatically invested. Tokenized stocks remain subject to issuer eligibility requirements.</p>
        {candidate.allocations.some((allocation) => allocation.asset === "DPRI") && <a className="text-link" href={DPRI_MARKET_URL} target="_blank" rel="noopener noreferrer">Open the DPRI market on GetEquity ↗</a>}
        {status === "saved" && <div className="pill pill-accent" style={{ alignSelf: "flex-start" }}><span className="dot" /> Rule saved · check agent status above</div>}
        <div className="row"><button className="btn btn-ghost" onClick={() => { setCandidate(null); setRule(null); setStatus("idle"); }}>Edit</button>{status !== "saved" && <button className="btn btn-primary" onClick={approveRule} disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Approve rule"}</button>}</div>
      </div>}
    </div>
  </section>;
}
