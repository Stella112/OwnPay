"use client";

import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "@/lib/contracts";
import { formatUiAmount } from "@/lib/format";
import { BASE_USDC_ADDRESS } from "@/lib/stablecoins";

export function UsdcBalance() {
  const { address } = useAccount();
  const { data, isLoading, isError } = useReadContracts({
    contracts: [
      { address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" },
    ],
    allowFailure: false,
    query: { enabled: !!address },
  });

  if (!address) return <span>—</span>;
  if (isLoading) return <span>Reading…</span>;
  if (isError || !data) return <span>Unavailable USDC</span>;
  const [raw, decimals] = data as [bigint, number];
  return <span>{formatUiAmount(raw, Number(decimals))} USDC</span>;
}
