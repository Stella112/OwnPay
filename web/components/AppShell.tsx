"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import { useEligibility } from "@/components/Eligibility";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";

type AppShellVariant = "base" | "robinhood-testnet";

export function AppShell({ children, variant = "base" }: { children: React.ReactNode; variant?: AppShellVariant }) {
  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="brand" aria-label="OwnPay home"><span className="logo-lockup"><img src="/ownpay-logo-lockup.png" alt="OwnPay" /></span></Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <Link href="/#product">Product</Link>
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#use-cases">Use cases</Link>
            <Link href="/#roadmap">Resources</Link>
          </nav>
          <div className="header-actions"><NetworkSwitch /><Link href={variant === "base" ? "/app" : "/robinhood"} className="header-dashboard-link">Dashboard</Link>{variant === "base" && <WalletButton />}</div>
        </div>
      </header>

      {variant === "base" && <NetworkNotice />}

      <main className="site-main">{children}</main>

      <AppFooter variant={variant} />
    </div>
  );
}

// Equivalent pages across the two networks, so switching keeps your place.
const TO_ROBINHOOD: Record<string, string> = { "/app": "/robinhood", "/pay": "/robinhood/pay", "/gift": "/robinhood/stocks", "/tip": "/robinhood/stocks", "/portfolio": "/robinhood/ownership", "/automation": "/robinhood/rules" };
const TO_BASE: Record<string, string> = { "/robinhood": "/app", "/robinhood/pay": "/pay", "/robinhood/stocks": "/gift", "/robinhood/ownership": "/portfolio", "/robinhood/rules": "/automation", "/robinhood/agent": "/automation" };

function NetworkSwitch() {
  const path = usePathname();
  const onRobinhood = path.startsWith("/robinhood");
  const baseHref = TO_BASE[path] ?? "/app";
  const rhHref = TO_ROBINHOOD[path] ?? "/robinhood";
  return (
    <div className="network-switch" role="group" aria-label="Network">
      <Link href={baseHref} className={!onRobinhood ? "network-switch-active" : ""} aria-current={!onRobinhood ? "true" : undefined}>Base</Link>
      <Link href={rhHref} className={onRobinhood ? "network-switch-active" : ""} aria-current={onRobinhood ? "true" : undefined}>Robinhood <small>testnet</small></Link>
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

function AppFooter({ variant }: { variant: AppShellVariant }) {
  const { openDisclosure } = useEligibility();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span className="muted">{variant === "base" ? "OwnPay · Base mainnet" : "OwnPay · Robinhood Chain Testnet"}</span>
        {variant === "base" && <button
          onClick={openDisclosure}
          style={{ background: "none", border: 0, color: "var(--accent)", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}
        >
          Eligibility &amp; disclosures
        </button>}
      </div>
    </footer>
  );
}
