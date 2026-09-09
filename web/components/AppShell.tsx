"use client";

import Link from "next/link";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import { useEligibility } from "@/components/Eligibility";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="brand" aria-label="OwnPay home"><span className="logo-lockup"><img src="/ownpay-logo-lockup.png" alt="OwnPay" /></span></Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="/#product">Product</a>
            <a href="/#how-it-works">How it works</a>
            <a href="/#use-cases">Use cases</a>
            <a href="/#roadmap">Resources</a>
          </nav>
          <div className="header-actions"><Link href="/app" className="header-dashboard-link">Dashboard</Link><WalletButton /></div>
        </div>
      </header>

      <NetworkNotice />

      <main className="site-main">{children}</main>

      <AppFooter />
    </div>
  );
}

function NetworkNotice() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === EXPECTED_CHAIN_ID) return null;

  return (
    <div className="network-notice">
      <div className="network-notice-inner spread">
        <span style={{ color: "var(--warn-ink)", fontSize: 13.5, fontWeight: 550 }}>
          You&apos;re on the wrong network. OwnPay runs on Base.
        </span>
        <button
          className="btn btn-ghost"
          style={{ minHeight: 36, padding: "6px 12px", fontSize: 13 }}
          onClick={() => switchChain({ chainId: EXPECTED_CHAIN_ID })}
          disabled={isPending}
        >
          {isPending ? "Switching…" : "Switch to Base"}
        </button>
      </div>
    </div>
  );
}

function AppFooter() {
  const { openDisclosure } = useEligibility();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span className="muted">OwnPay · Base mainnet</span>
        <button
          onClick={openDisclosure}
          style={{ background: "none", border: 0, color: "var(--accent)", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}
        >
          Eligibility &amp; disclosures
        </button>
      </div>
    </footer>
  );
}
