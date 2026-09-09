"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/recipient";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [menu, setMenu] = useState(false);

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

  // De-duplicate connectors by name (wagmi can list several injected variants).
  const seen = new Set<string>();
  const options = connectors.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn btn-primary"
        style={compact}
        onClick={() => setMenu((m) => !m)}
        disabled={isPending}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {menu && (
        <div className="panel" style={dropdown}>
          <div className="stack" style={{ ["--gap" as string]: "8px" }}>
            {options.map((c) => (
              <button
                key={c.uid}
                className="btn btn-ghost btn-block"
                onClick={() => {
                  connect({ connector: c });
                  setMenu(false);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const compact: React.CSSProperties = { minHeight: 40, padding: "8px 14px", fontSize: 14 };

const dropdown: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 8px)",
  width: 220,
  padding: 10,
  zIndex: 40,
  boxShadow: "var(--shadow-raise)",
};
