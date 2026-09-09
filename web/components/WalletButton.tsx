"use client";

import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/recipient";
import { PrivyLoginButton } from "@/components/PrivyLoginButton";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [menu, setMenu] = useState(false);

  // OwnPay uses Privy as the user-facing entry point. The legacy external
  // connector menu remains available only as a silent fallback for local
  // deployments that do not have a Privy app configured.
  if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <PrivyLoginButton />;
  }

  if (isConnected && address) {
    return (
      <div style={{ position: "relative" }}>
        <button className="btn btn-ghost" style={compact} onClick={() => setMenu((m) => !m)}>
          <span className="dot" style={{ color: "var(--accent)" }} />
          <span className="tnum">{shortAddress(address)}</span>
        </button>
        {menu && (
          <div className="panel" style={dropdown}>
            <button
              className="btn btn-ghost btn-block"
              onClick={() => {
                disconnect();
                setMenu(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}

const compact: React.CSSProperties = { minHeight: 40, padding: "8px 14px", fontSize: 14 };
