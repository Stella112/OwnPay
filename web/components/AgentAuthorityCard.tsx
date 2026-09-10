"use client";

import { useEffect, useMemo, useState } from "react";
import { getEmbeddedConnectedWallet, getIdentityToken, useIdentityToken, usePrivy, useSigners, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import type { AgentAuthorization } from "@/lib/db";

type ApiResponse = { error?: string; authorization?: AgentAuthorization | null };

export function AgentAuthorityCard() {
  const { authenticated, user, createWallet } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets, ready: walletsReady } = useWallets();
  const { address } = useAccount();
  const { addSigners, removeSigners } = useSigners();
  const keyQuorumId = process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID;
  const embeddedWallet = useMemo(() => getEmbeddedConnectedWallet(wallets), [wallets]);
  const embeddedWalletId = useMemo(() => {
    if (!embeddedWallet || !user) return null;
    const linked = user.linkedAccounts.find((account) => account.type === "wallet" && "address" in account && account.address.toLowerCase() === embeddedWallet.address.toLowerCase());
    return linked && "id" in linked && typeof linked.id === "string" ? linked.id : null;
  }, [embeddedWallet, user]);
  const walletAddress = embeddedWallet?.address ?? address;
  const [authorization, setAuthorization] = useState<AgentAuthorization | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function refreshStatus() {
    const token = identityToken ?? await getIdentityToken();
    if (!token || !walletAddress) throw new Error("Sign in with an embedded wallet to manage agent access.");
    const response = await fetch(`/api/automation?wallet=${encodeURIComponent(walletAddress)}`, { headers: { "x-privy-id-token": token }, cache: "no-store" });
    const body = await response.json() as ApiResponse;
    if (!response.ok) throw new Error(body.error ?? "Could not load agent status.");
    const next = body.authorization ?? null;
    setAuthorization(next);
    return next;
  }

  async function call(action: string, extra: Record<string, string> = {}, walletAddressOverride?: string) {
    const token = identityToken ?? await getIdentityToken();
    const requestedWalletAddress = walletAddressOverride ?? walletAddress;
    if (!token || !requestedWalletAddress) throw new Error("Sign in with an embedded wallet to manage agent access.");
    const response = await fetch("/api/automation", { method: "POST", headers: { "content-type": "application/json", "x-privy-id-token": token }, body: JSON.stringify({ walletAddress: requestedWalletAddress, action, ...extra }) });
    const body = await response.json() as ApiResponse;
    if (!response.ok) throw new Error(body.error ?? "Could not update agent access.");
    setAuthorization(body.authorization ?? null);
  }

  useEffect(() => {
    if (!authenticated || !identityToken || !walletAddress) return;
    fetch(`/api/automation?wallet=${encodeURIComponent(walletAddress)}`, { headers: { "x-privy-id-token": identityToken }, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as ApiResponse; if (!response.ok) throw new Error(body.error ?? "Could not load agent status."); return body.authorization ?? null; })
      .then(setAuthorization)
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : "Could not load agent status."));
  }, [authenticated, identityToken, walletAddress]);

  async function enable() {
    setBusy(true); setMessage("Opening Privy authorization…");
    try {
      if (!walletsReady) throw new Error("Your Privy wallet is still loading. Try again in a moment.");
      if (!keyQuorumId) throw new Error("Agent signer configuration is not available yet. Refresh after the deployment finishes.");
      const authorityWallet = embeddedWallet ?? await createWallet();
      let authorityWalletId = embeddedWalletId ?? ("id" in authorityWallet && typeof authorityWallet.id === "string" ? authorityWallet.id : null);
      try {
        const signerResult = await addSigners({ address: authorityWallet.address, signers: [{ signerId: keyQuorumId, policyIds: [] }] });
        const delegatedLinkedAccount = signerResult.user.linkedAccounts.find((account) => account.type === "wallet" && "address" in account && account.address.toLowerCase() === authorityWallet.address.toLowerCase());
        authorityWalletId = delegatedLinkedAccount && "id" in delegatedLinkedAccount && typeof delegatedLinkedAccount.id === "string" ? delegatedLinkedAccount.id : authorityWalletId;
      } catch (cause) {
        // Privy makes this operation idempotent at the product level but may
        // return a duplicate-signer error. The signer is already usable in
        // that case, so continue to register the local authorization.
        const duplicate = cause instanceof Error && /duplicate signer|already been added/i.test(cause.message);
        if (!duplicate) throw cause;
      }
      if (!authorityWalletId) throw new Error("Privy did not return the embedded wallet ID yet. Refresh and try again.");
      await call("activate", { privyWalletId: authorityWalletId }, authorityWallet.address);
      await refreshStatus();
      setMessage("Limited agent authority is active, with automation paused until you resume it.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Delegation was not completed."); }
    finally { setBusy(false); }
  }

  async function togglePause() {
    setBusy(true); setMessage(undefined);
    try { await call(authorization?.automationPaused ? "resume" : "pause"); setMessage(authorization?.automationPaused ? "Automation resumed." : "Automation paused."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not change automation status."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true); setMessage(undefined);
    try { await removeSigners({ address: embeddedWallet?.address ?? walletAddress ?? "" }); await call("revoke"); setMessage("Agent access revoked. No new automated action can run."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not revoke agent access."); }
    finally { setBusy(false); }
  }

  const active = authorization?.status === "ACTIVE" && authorization.privyDelegated;
  return <section className="dashboard-section" aria-labelledby="agent-authority-title">
    <div className="section-heading"><div><p className="eyebrow">Automation controls</p><h2 id="agent-authority-title">OwnPay Ownership Agent</h2></div><span className="section-count">Base · limited authority</span></div>
    <div className="panel stack agent-authority-card" style={{ ["--gap" as string]: "12px", marginTop: 20 }}>
      <p className="soft" style={{ margin: 0, lineHeight: 1.5 }}>The agent can only be enabled after your explicit Privy delegation. OwnPay still enforces Base-only assets, verified contracts, and your saved spending limits.</p>
      <div className="agent-authority-status"><span className={`dot ${active ? "dot-success" : ""}`} /> <strong>{!active ? "Authority not configured" : authorization?.automationPaused ? "Automation paused" : "Automation active"}</strong></div>
      <p className="field-hint" style={{ margin: 0 }}>{!walletsReady ? "Loading your Privy wallet…" : embeddedWallet ? "Embedded wallet ready for limited automation." : "An embedded wallet will be created when you grant access. External wallets remain supported for manual payments."}</p>
      {message && <div className="field-hint" role="status">{message}</div>}
      <div className="row">
        {!active ? <button type="button" className="btn btn-primary" onClick={() => { void enable(); }} disabled={busy || !authenticated}>{busy ? "Waiting…" : "Grant limited access"}</button> : <><button type="button" className="btn btn-ghost" onClick={togglePause} disabled={busy}>{authorization?.automationPaused ? "Resume Automation" : "Pause Automation"}</button><button type="button" className="btn btn-ghost" onClick={revoke} disabled={busy}>Revoke Agent Access</button></>}
        {!active && <button className="btn btn-ghost" onClick={() => { setBusy(true); setMessage(undefined); refreshStatus().catch((cause) => setMessage(cause instanceof Error ? cause.message : "Could not refresh agent status.")).finally(() => setBusy(false)); }} disabled={busy || !authenticated}>Refresh status</button>}
      </div>
    </div>
  </section>;
}
