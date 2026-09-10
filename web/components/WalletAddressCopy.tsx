"use client";

import { useState } from "react";
import type { Address } from "viem";
import { OwnPayIcon } from "@/components/OwnPayIcon";

export function WalletAddressCopy({ address, compact = false }: { address: Address; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={`wallet-copy-button${compact ? " wallet-copy-button-compact" : ""}`} onClick={() => void copyAddress()}>
      <OwnPayIcon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : "Copy wallet"}
    </button>
  );
}
