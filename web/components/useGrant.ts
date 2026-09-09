"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { STOCK_VESTING_ADDRESS, stockVestingAbi, erc20Abi } from "@/lib/contracts";
import { getDecimals, rawToUi } from "@/lib/b20";
import { tokenByAddress } from "@/lib/tokens";

export type GrantRaw = {
  token: Address;
  from: Address;
  to: Address;
  total: bigint;
  released: bigint;
  start: number;
  cliff: number;
  duration: number;
  revocable: boolean;
  revoked: boolean;
  memo: `0x${string}`;
};

function parseGrant(tuple: readonly unknown[]): GrantRaw {
  return {
    token: tuple[0] as Address,
    from: tuple[1] as Address,
    to: tuple[2] as Address,
    total: tuple[3] as bigint,
    released: tuple[4] as bigint,
    start: Number(tuple[5]),
    cliff: Number(tuple[6]),
    duration: Number(tuple[7]),
    revocable: tuple[8] as boolean,
    revoked: tuple[9] as boolean,
    memo: tuple[10] as `0x${string}`,
  };
}

export type GrantView = {
  isLoading: boolean;
  notFound: boolean;
  error?: string;
  grant?: GrantRaw;
  decimals?: number;
  symbol?: string;
  totalUi?: bigint;
  releasedUi?: bigint;
  /** Authoritative vested RAW converted through the B20 helper. */
  vestedUi?: bigint;
  /** Authoritative claimable RAW from chain (gates the claim button). */
  releasableRaw?: bigint;
  /** Authoritative claimable RAW converted through the B20 helper. */
  releasableUi?: bigint;
  refetch: () => void;
  /** Local prediction of vested UI base-units at time `nowSec` (linear vesting, spec A8). */
  vestedUiAt: (nowSec: number) => bigint;
  end: number;
};

export function useGrant(id: bigint | undefined): GrantView {
  const client = usePublicClient();
  const enabled = STOCK_VESTING_ADDRESS !== undefined && id !== undefined;

  const grantRead = useReadContract({
    address: STOCK_VESTING_ADDRESS,
    abi: stockVestingAbi,
    functionName: "grants",
    args: id !== undefined ? [id] : undefined,
    query: { enabled },
  });

  const releasableRead = useReadContract({
    address: STOCK_VESTING_ADDRESS,
    abi: stockVestingAbi,
    functionName: "releasableRaw",
    args: id !== undefined ? [id] : undefined,
    query: { enabled, refetchInterval: 8000 },
  });

  const vestedRead = useReadContract({
    address: STOCK_VESTING_ADDRESS,
    abi: stockVestingAbi,
    functionName: "vestedRaw",
    args: id !== undefined ? [id] : undefined,
    query: { enabled, refetchInterval: 2000 },
  });

  const grant = grantRead.data ? parseGrant(grantRead.data as readonly unknown[]) : undefined;
  const notFound =
    grant !== undefined && grant.to === "0x0000000000000000000000000000000000000000";

  const token = grant?.token;

  const meta = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!token && !notFound },
  });

  // Convert the discrete on-chain quantities (total, released) via the centralized
  // B20 helper. The live-ticking vested figure is derived locally from these.
  const conv = useQuery({
    queryKey: [
      "grant-ui",
      token,
      grant?.total?.toString(),
      grant?.released?.toString(),
      vestedRead.data?.toString(),
      releasableRead.data?.toString(),
    ],
    enabled: !!client && !!token && !!grant && !notFound,
    queryFn: async () => {
      if (!client || !token || !grant) throw new Error("not ready");
      const decimals = await getDecimals(client, token);
      const totalUi = await rawToUi(client, token, grant.total);
      const releasedUi = await rawToUi(client, token, grant.released);
      const vestedRaw = vestedRead.data as bigint | undefined;
      const releasableRaw = releasableRead.data as bigint | undefined;
      const vestedUi = vestedRaw === undefined ? undefined : await rawToUi(client, token, vestedRaw);
      const releasableUi = releasableRaw === undefined ? undefined : await rawToUi(client, token, releasableRaw);
      return { decimals, totalUi, releasedUi, vestedUi, releasableUi };
    },
  });

  const symbolFromAllowlist = token ? tokenByAddress(token)?.symbol : undefined;
  const symbol = symbolFromAllowlist ?? (meta.data as string | undefined);

  const end = grant ? grant.start + grant.duration : 0;

  const vestedUiAt = useMemo(() => {
    return (nowSec: number): bigint => {
      if (!grant || conv.data === undefined) return 0n;
      const { totalUi, vestedUi } = conv.data;
      if (vestedUi !== undefined) return vestedUi;
      if (grant.revoked) return totalUi; // capped total after revoke
      const t = Math.floor(nowSec); // tick is fractional seconds; BigInt needs an integer
      if (t < grant.cliff) return 0n;
      if (t >= end) return totalUi;
      // linear in UI space — matches on-chain vestedRaw converted to UI (both linear).
      const elapsed = BigInt(t - grant.start);
      const dur = BigInt(grant.duration);
      return (totalUi * elapsed) / dur;
    };
  }, [grant, conv.data, end]);

  return {
    isLoading: grantRead.isLoading || (enabled && !grant && !grantRead.error),
    notFound: !!notFound,
    error: grantRead.error?.message,
    grant,
    decimals: conv.data?.decimals,
    symbol,
    totalUi: conv.data?.totalUi,
    releasedUi: conv.data?.releasedUi,
    vestedUi: conv.data?.vestedUi,
    releasableRaw: releasableRead.data as bigint | undefined,
    releasableUi: conv.data?.releasableUi,
    refetch: () => {
      grantRead.refetch();
      releasableRead.refetch();
      vestedRead.refetch();
    },
    vestedUiAt,
    end,
  };
}

/** A ticking "now" in unix seconds; updates ~4x/second, honoring reduced motion. */
export function useNowTicking(): number {
  return useTick();
}

function useTick(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const period = reduce ? 1000 : 250;
    const t = setInterval(() => setNow(Date.now() / 1000), period);
    return () => clearInterval(t);
  }, []);
  return now;
}
