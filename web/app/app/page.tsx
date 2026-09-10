"use client";

import Link from "next/link";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { CharacterVisual } from "@/components/CharacterVisual";
import { OwnPayIcon } from "@/components/OwnPayIcon";
import { WalletButton } from "@/components/WalletButton";
import { OwnPayLinkCard } from "@/components/OwnPayLinkTools";
import { shortAddress } from "@/lib/recipient";
import { lookupName } from "@/lib/recipient";
import { UsdcBalance } from "@/components/UsdcBalance";
import { OwnershipRulesPanel } from "@/components/OwnershipRulesPanel";
import { WalletAddressCopy } from "@/components/WalletAddressCopy";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { useEffect, useState } from "react";

const actions = [
  { href: "/pay", label: "Pay", detail: "Vesting grant", icon: "send" as const },
  { href: "/gift", label: "Gift", detail: "Lock stock for a moment", icon: "gift" as const },
  { href: "/tip", label: "Tip", detail: "Instant stock + memo", icon: "tip" as const },
  { href: "#grants", label: "Claim", detail: "See your grants", icon: "claim" as const },
];

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const [basename, setBasename] = useState<string>();
  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  useEffect(() => {
    let active = true;
    if (!publicClient || !address) { setBasename(undefined); return () => { active = false; }; }
    lookupName(publicClient, address).then((name) => { if (active) setBasename(name); }).catch(() => undefined);
    return () => { active = false; };
  }, [publicClient, address]);

  return (
    <AppShell>
      <div className="dashboard-frame">
        <DashboardSidebar active="home" />

        <main className="dashboard-main">
          <div className="dashboard-welcome-row">
            <div>
              <p className="eyebrow">OwnPay dashboard</p>
              <h1>Good morning<span className="welcome-mark">.</span></h1>
              <p className="dashboard-subtitle">Your ownership, in one place.</p>
            </div>
            <div className="dashboard-identity">
              <span className="identity-avatar"><OwnPayIcon name="wallet" size={21} /></span>
              <span>
                <strong>{address ? shortAddress(address) : "Not signed in"}</strong>
                <small>{isConnected ? (wrongNetwork ? "Switch to Base" : "Connected on Base") : "Sign in to see your grants"}</small>
              </span>
              {address && <WalletAddressCopy address={address} compact />}
            </div>
          </div>

          <section className="dashboard-hero-grid" aria-label="Dashboard summary">
            <div className="dashboard-summary panel-warm">
              <div className="summary-topline"><span>Ownership overview</span><span className="summary-live"><span className="caption-dot" /> Base mainnet</span></div>
              <p className="summary-value"><UsdcBalance /></p>
              <p className="summary-note">Live canonical USDC balance on Base. Stock ownership is shown from verified B20 reads.</p>
              {!isConnected && <WalletButton />}
              {wrongNetwork && <p className="dashboard-warning">Your wallet is connected to another network. OwnPay actions run on Base.</p>}
            </div>
            <div className="dashboard-visual-panel">
              <div className="visual-copy"><span className="pill pill-butter">Ownership, not points</span><h2>Small actions.<br />Real upside.</h2><p>Pay, gift, tip, vest, and claim official tokenized stocks on Base.</p></div>
              <CharacterVisual compact />
            </div>
          </section>

          {isConnected && address && <OwnPayLinkCard recipient={basename ?? address} displayName={basename ?? shortAddress(address)} />}

          <section className="dashboard-section" aria-labelledby="quick-actions-title">
            <div className="section-heading"><div><p className="eyebrow">Move ownership</p><h2 id="quick-actions-title">Quick actions</h2></div><Link href="/" className="text-link">How OwnPay works <OwnPayIcon name="arrow" size={16} /></Link></div>
            <div className="quick-actions-grid">
              {actions.map((action) => <Link className="quick-action" href={action.href} key={action.label}><span className="quick-action-icon"><OwnPayIcon name={action.icon} size={20} /></span><span><strong>{action.label}</strong><small>{action.detail}</small></span><OwnPayIcon name="arrow" size={17} /></Link>)}
            </div>
          </section>

          <section id="grants" className="dashboard-section" aria-labelledby="grants-title">
            <div className="section-heading"><div><p className="eyebrow">Onchain activity</p><h2 id="grants-title">Your grants</h2></div><span className="section-count">Live from Base</span></div>
            <div className="empty-state"><span className="empty-state-icon"><OwnPayIcon name="spark" size={22} /></span><h3>{isConnected ? "No grants found yet." : "Sign in to see your grants."}</h3><p>{isConnected ? "Send your first stock grant and start turning payments into ownership." : "Your dashboard never invents balances or activity. Sign in to read your onchain activity."}</p><Link href="/pay" className="btn btn-primary">Send stock <OwnPayIcon name="arrow" size={17} /></Link></div>
          </section>

          {process.env.NEXT_PUBLIC_PRIVY_APP_ID && isConnected && <OwnershipRulesPanel />}

          <section id="activity" className="ownership-note">
            <div><span className="eyebrow">The OwnPay promise</span><h2>Ownership should move as easily as money.</h2><p>Stablecoins made global payments easier. OwnPay makes ownership programmable — with real Coinbase Tokenized Stocks, self-custodied on Base.</p></div>
            <div className="note-seal"><OwnPayIcon name="shield" size={26} /><span>Raw B20 accounting<br />scaled share display</span></div>
          </section>
        </main>
      </div>
    </AppShell>
  );
}
