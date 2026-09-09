"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/contracts";
import { formatUiAmount } from "@/lib/format";
import { BASE_USDC_ADDRESS } from "@/lib/stablecoins";

export function UsdcBalance() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [balance, setBalance] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!address || !publicClient) {
      setBalance(undefined);
      return () => { active = false; };
    }
    setLoading(true);
    Promise.all([
      publicClient.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }),
    ]).then(([raw, decimals]) => {
      if (active) setBalance(formatUiAmount(raw as bigint, Number(decimals)));
    }).catch(() => {
      if (active) setBalance(undefined);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [address, publicClient]);

  if (!address) return <span>—</span>;
  if (loading && balance === undefined) return <span>Reading…</span>;
  return <span>{balance ?? "Unavailable"} USDC</span>;
}
