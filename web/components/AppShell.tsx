"use client";

import Link from "next/link";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import { useEligibility } from "@/components/Eligibility";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="appbar">
        <div className="container">
          <Link href="/" className="brand" aria-label="OwnPay home">
            <span className="brand-mark">O</span>
            <span>OwnPay</span>
          </Link>
          <WalletButton />
        </div>
      </header>

      <NetworkNotice />

      <main style={{ flex: 1, paddingTop: 20, paddingBottom: 48 }}>{children}</main>

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
    <div style={{ background: "var(--warn-tint)", borderBottom: "1px solid var(--hairline)" }}>
      <div className="container spread" style={{ paddingTop: 10, paddingBottom: 10 }}>
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
    <footer style={{ borderTop: "1px solid var(--hairline)", padding: "18px 0" }}>
      <div className="container spread" style={{ fontSize: 12.5 }}>
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
