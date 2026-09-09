"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { usePublicClient } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { GrantComposer } from "@/components/GrantComposer";
import { TipComposer } from "@/components/TipComposer";
import { OwnPayIcon } from "@/components/OwnPayIcon";
import { OwnPayLinkTools, OwnPayQrPreview } from "@/components/OwnPayLinkTools";
import { resolveRecipient, shortAddress, type ResolvedRecipient } from "@/lib/recipient";
import { isOwnPayLinkMode, normalizeOwnPayLinkRecipient, type OwnPayLinkMode } from "@/lib/ownpay-links";

export default function OwnPayLinkPage() {
  return <OwnPayLinkView />;
}

function OwnPayLinkView() {
  const pathname = usePathname();
  const router = useRouter();
  const publicClient = usePublicClient();
  const [resolved, setResolved] = useState<ResolvedRecipient>();
  const [resolutionError, setResolutionError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const rawRecipient = useMemo(() => {
    const marker = "/p/";
    const encodedRecipient = pathname.startsWith(marker) ? pathname.slice(marker.length) : "";
    try { return decodeURIComponent(encodedRecipient); } catch { return ""; }
  }, [pathname]);
  const normalizedRecipient = useMemo(() => normalizeOwnPayLinkRecipient(rawRecipient), [rawRecipient]);
  const directResolved: ResolvedRecipient | undefined = useMemo(() => normalizedRecipient && isAddress(normalizedRecipient)
    ? { address: getAddress(normalizedRecipient), source: "address" as const }
    : undefined, [normalizedRecipient]);
  const [mode, setMode] = useState<OwnPayLinkMode>("pay");

  useEffect(() => {
    const modeParam = new URLSearchParams(window.location.search).get("mode");
    setMode(isOwnPayLinkMode(modeParam) ? modeParam : "pay");
  }, [pathname]);

  useEffect(() => {
    let active = true;
    setResolved(undefined);
    setResolutionError(undefined);
    setLoading(true);
    if (!normalizedRecipient) {
      setResolutionError("This OwnPay Link is invalid.");
      setLoading(false);
      return () => { active = false; };
    }
    if (directResolved) {
      setResolved(directResolved);
      setLoading(false);
      return () => { active = false; };
    }
    if (!publicClient) {
      setResolutionError("This OwnPay Link is invalid.");
      setLoading(false);
      return () => { active = false; };
    }
    resolveRecipient(publicClient, normalizedRecipient).then((result) => {
      if (!active) return;
      if (result.ok) setResolved(result.value);
      else setResolutionError(result.message);
      setLoading(false);
    }).catch(() => {
      if (active) { setResolutionError("This OwnPay Link is invalid."); setLoading(false); }
    });
    return () => { active = false; };
  }, [directResolved, normalizedRecipient, publicClient]);

  function changeMode(next: OwnPayLinkMode) {
    setMode(next);
    const query = next === "pay" ? "" : `?mode=${next}`;
    router.replace(`${pathname}${query}`, { scroll: false });
  }

  if (!normalizedRecipient) return <InvalidLink />;
  const effectiveResolved = directResolved ?? resolved;
  if (!effectiveResolved && loading) return <LinkLoading />;
  if (resolutionError || !effectiveResolved) return <InvalidLink />;

  const displayName = effectiveResolved.name ?? shortAddress(effectiveResolved.address);
  const modeLabel = mode === "pay" ? "Pay" : mode === "gift" ? "Gift" : "Tip";

  return (
    <AppShell>
      <div className="link-page">
        <div className="link-page-header"><Link href="/" className="text-link" style={{ marginTop: 0 }}><OwnPayIcon name="arrow" size={16} /> Back to OwnPay</Link><div className="link-page-actions"><a href="#qr" className="btn btn-butter"><OwnPayIcon name="spark" size={16} /><span>QR</span></a><a href="#link-tools" className="btn btn-ghost"><OwnPayIcon name="send" size={16} /><span>Share</span></a></div></div>
        <section className="link-hero" aria-labelledby="link-title">
          <div><div className="link-recipient-identity"><span className="recipient-avatar"><OwnPayIcon name="wallet" size={27} /></span><span><strong>{displayName}</strong><small>{effectiveResolved.name ? shortAddress(effectiveResolved.address) : "Base wallet recipient"}</small></span></div><span className="eyebrow">OwnPay Link · Base mainnet</span><h1 id="link-title">Send ownership to {displayName}.</h1><p>Pay, gift, or tip with real Coinbase Tokenized Stocks on Base.</p></div>
          <div className="link-hero-art"><OwnPayQrPreview recipient={effectiveResolved.name ?? effectiveResolved.address} mode={mode} /></div>
        </section>
        <div className="link-content">
          <aside id="qr" className="link-side-card"><div><span className="eyebrow">Link. Scan. Pay. Own.</span><h2>Share ownership</h2><p>Every valid OwnPay Link comes with a scannable QR.</p></div><div className="link-side-qr"><OwnPayQrPreview recipient={effectiveResolved.name ?? effectiveResolved.address} mode={mode} /></div><span className="link-side-caption">{modeLabel} {effectiveResolved.name ?? shortAddress(effectiveResolved.address)}</span></aside>
          <section className="link-form-card" aria-labelledby="mode-title"><div id="mode-title" className="mode-selector" role="group" aria-label="Choose how to send ownership"><button type="button" aria-pressed={mode === "pay"} onClick={() => changeMode("pay")}>Pay</button><button type="button" aria-pressed={mode === "gift"} onClick={() => changeMode("gift")}>Gift</button><button type="button" aria-pressed={mode === "tip"} onClick={() => changeMode("tip")}>Tip</button></div><div className="link-form-label"><h2>{modeLabel} {effectiveResolved.name ? `to ${effectiveResolved.name}` : "to this wallet"}</h2><span>Recipient locked</span></div>{mode === "tip" ? <TipComposer initialRecipient={effectiveResolved.address} lockedRecipient /> : <GrantComposer mode={mode} initialRecipient={effectiveResolved.address} lockedRecipient />}</section>
        </div>
        <div id="link-tools"><OwnPayLinkTools recipient={effectiveResolved.name ?? effectiveResolved.address} displayName={displayName} mode={mode} /></div>
      </div>
    </AppShell>
  );
}

function InvalidLink() {
  return <AppShell><div className="link-page"><div className="link-invalid"><span className="invalid-icon"><OwnPayIcon name="close" size={25} /></span><h1>This OwnPay Link is invalid.</h1><p>Check the link or ask the recipient to send you a new OwnPay Link.</p><Link href="/" className="btn btn-primary" style={{ marginTop: 23 }}>Go to OwnPay</Link></div></div></AppShell>;
}

function LinkLoading() {
  return <AppShell><div className="link-page"><div className="link-invalid"><span className="invalid-icon"><OwnPayIcon name="spark" size={25} /></span><h1>Loading OwnPay Link…</h1><p>Resolving the recipient on Base.</p></div></div></AppShell>;
}
