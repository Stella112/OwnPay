"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Address, Hex } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { WalletButton } from "@/components/WalletButton";
import { useGrant, useNowTicking } from "@/components/useGrant";
import { STOCK_VESTING_ADDRESS, stockVestingAbi } from "@/lib/contracts";
import { formatUiAmount, formatDate, formatCountdown } from "@/lib/format";
import { decodeMemo, isEmptyMemo } from "@/lib/memo";
import { shortAddress } from "@/lib/recipient";
import { tokenByAddress } from "@/lib/tokens";
import { friendlyTxError } from "@/components/GrantComposer";
import { BASESCAN_TX } from "@/lib/explorer";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { useOwnPayTransaction } from "@/components/OwnPayTransactionProvider";

export default function ClaimPage() {
  const params = useParams<{ id: string }>();
  const idStr = Array.isArray(params.id) ? params.id[0] : params.id;
  const validId = /^\d+$/.test(idStr ?? "");
  const id = validId ? BigInt(idStr) : undefined;

  return (
    <AppShell>
      <div className="container">
        {!validId ? (
          <Empty title="Invalid link" body="This claim link isn't a valid grant id." />
        ) : (
          <ClaimView id={id!} />
        )}
      </div>
    </AppShell>
  );
}

function ClaimView({ id }: { id: bigint }) {
  const g = useGrant(id);
  const now = useNowTicking();
  const { address } = useAccount();

  if (g.isLoading) return <Empty title="Loading grant…" body="Reading from Base." />;
  if (g.error) return <Empty title="Couldn’t load grant" body="Try again in a moment. The claim page only uses values read from Base." />;
  if (g.notFound || !g.grant) return <Empty title="Grant not found" body={`No grant #${id.toString()} exists on this contract.`} />;
  if (g.decimals === undefined || g.totalUi === undefined || g.releasedUi === undefined) {
    return <Empty title="Reading grant details…" body="Loading the token precision and B20 share conversion from Base." />;
  }

  const grant = g.grant;
  const decimals = g.decimals;
  const name = tokenByAddress(grant.token)?.name;
  const symbol = g.symbol ?? "shares";

  const totalUi = g.totalUi;
  const releasedUi = g.releasedUi;
  const vestedUi = g.vestedUi ?? g.vestedUiAt(now);
  const claimableUi = g.releasableUi ?? (vestedUi > releasedUi ? vestedUi - releasedUi : 0n);
  const remainingUi = totalUi > releasedUi ? totalUi - releasedUi : 0n;
  const pct = totalUi > 0n ? Number((vestedUi * 10000n) / totalUi) / 100 : 0;

  const memoText = isEmptyMemo(grant.memo) ? "" : decodeMemo(grant.memo);
  const nowSec = Math.floor(now);
  const beforeCliff = nowSec < grant.cliff;
  const isRecipient = address && address.toLowerCase() === grant.to.toLowerCase();
  const isEmployer = address && address.toLowerCase() === grant.from.toLowerCase();

  const canClaim = g.releasableRaw !== undefined && g.releasableRaw > 0n;

  return (
    <div className="stack" style={{ ["--gap" as string]: "22px", paddingTop: 8 }}>
      {/* HERO */}
      <section style={{ textAlign: "center", paddingTop: 18 }}>
        <div className="pill pill-accent" style={{ display: "inline-flex" }}>
          {grant.revoked ? "Revoked grant" : grant.revocable ? "Vesting grant" : "Stock gift"}
        </div>
        <div className="hero-figure tnum" style={{ marginTop: 18, color: "var(--ink)" }}>
          {formatUiAmount(vestedUi, decimals, { maxFractionDigits: 6, minFractionDigits: 2 })}
        </div>
        <div className="hero-unit" style={{ marginTop: 10 }}>
          {name ? `${symbol} of ${name} vested` : `${symbol} vested`}
        </div>

        <div className="progress" style={{ marginTop: 20 }} aria-label={`${pct.toFixed(1)}% vested`}>
          <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <div className="spread" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {beforeCliff ? "Not started" : pct >= 100 ? "Fully vested" : `${pct.toFixed(1)}% vested`}
          </span>
          <span className="muted tnum" style={{ fontSize: 12.5 }}>
            of {formatUiAmount(totalUi, decimals)} {symbol}
          </span>
        </div>
      </section>

      {/* CLAIM ACTION */}
      <ClaimActions
        id={id}
        canClaim={!!canClaim}
        claimableUi={claimableUi}
        decimals={decimals}
        symbol={symbol}
        beforeCliff={beforeCliff}
        cliff={grant.cliff}
        nowSec={nowSec}
        revoked={grant.revoked}
        released={releasedUi > 0n}
        isRecipient={!!isRecipient}
        onDone={g.refetch}
      />

      {/* DETAILS */}
      <div className="panel">
        <dl className="meta">
          <dt>Claimable now</dt>
          <dd className="tnum">{formatUiAmount(claimableUi, decimals)} {symbol}</dd>
          <dt>Released</dt>
          <dd className="tnum">{formatUiAmount(releasedUi, decimals)} {symbol}</dd>
          <dt>Remaining</dt>
          <dd className="tnum">{formatUiAmount(remainingUi, decimals)} {symbol}</dd>
          <dt>Total</dt>
          <dd className="tnum">{formatUiAmount(totalUi, decimals)} {symbol}</dd>
          <dt>{grant.revocable ? "Cliff" : "Unlocks"}</dt>
          <dd>
            {formatDate(grant.cliff)}
            {beforeCliff && <span className="muted"> · in {formatCountdown(grant.cliff, nowSec)}</span>}
          </dd>
          {grant.revocable && (
            <>
              <dt>Fully vests</dt>
              <dd>{formatDate(g.end)}</dd>
            </>
          )}
          <dt>From</dt>
          <dd className="tnum">{shortAddress(grant.from)}</dd>
          <dt>To</dt>
          <dd className="tnum">{shortAddress(grant.to)}</dd>
          {memoText && (<><dt>Memo</dt><dd>{memoText}</dd></>)}
        </dl>
      </div>

      {/* live-ticking explanation (spec A8) */}
      {!beforeCliff && !grant.revoked && pct < 100 && (
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, textAlign: "center" }}>
          Your stock entitlement is vesting continuously. OwnPay keeps the grant in raw B20 units, so
          B20 multiplier-based corporate-action adjustments stay reflected even while it&apos;s locked.
        </p>
      )}

      {/* revoke (employer only) */}
      {isEmployer && grant.revocable && !grant.revoked && (
        <RevokeAction id={id} onDone={g.refetch} />
      )}
    </div>
  );
}

function ClaimActions(props: {
  id: bigint;
  canClaim: boolean;
  claimableUi: bigint;
  decimals: number;
  symbol: string;
  beforeCliff: boolean;
  cliff: number;
  nowSec: number;
  revoked: boolean;
  released: boolean;
  isRecipient: boolean;
  onDone: () => void;
}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useOwnPayTransaction();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [detail, setDetail] = useState<string>("");
  const [hash, setHash] = useState<Hex | undefined>();
  const [error, setError] = useState<string | undefined>();

  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  async function claim() {
    if (!publicClient) return;
    setError(undefined);
    setPhase("running");
    try {
      setDetail("Waiting for wallet…");
      const h = await writeContractAsync({
        address: STOCK_VESTING_ADDRESS as Address,
        abi: stockVestingAbi,
        functionName: "release",
        args: [props.id],
      });
      setHash(h);
      setDetail("Confirming on Base…");
      await publicClient.waitForTransactionReceipt({ hash: h });
      setPhase("done");
      setDetail("");
      props.onDone();
    } catch (e) {
      setError(friendlyTxError(e));
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="panel stack" style={{ ["--gap" as string]: "12px" }}>
        <span className="pill pill-accent" style={{ alignSelf: "center" }}><span className="dot" /> Claimed on Base</span>
        {hash && (
          <a className="btn btn-ghost btn-block" href={BASESCAN_TX(hash)} target="_blank" rel="noopener noreferrer">
            View transaction ↗
          </a>
        )}
      </div>
    );
  }

  // Nothing to claim — explain why with a date/reason (spec C11).
  if (!props.canClaim) {
    let reason: string;
    if (props.revoked) reason = props.released ? "This grant was revoked. You claimed what had vested." : "This grant was revoked before anything vested.";
    else if (props.beforeCliff) reason = `Nothing has vested yet. Unlocks ${formatDate(props.cliff)} · in ${formatCountdown(props.cliff, props.nowSec)}.`;
    else reason = "You've claimed everything that has vested so far. Check back as more vests.";
    return (
      <div className="panel" style={{ textAlign: "center" }}>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>{reason}</p>
        {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="stack" style={{ ["--gap" as string]: "10px" }}>
      {!isConnected ? (
        <div className="stack" style={{ ["--gap" as string]: "8px", alignItems: "center" }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Connect the recipient wallet to claim.</p>
          <WalletButton />
        </div>
      ) : wrongNetwork ? (
        <button className="btn btn-primary btn-block" disabled>Switch to Base to claim</button>
      ) : (
        <button className="btn btn-primary btn-block" onClick={claim} disabled={phase === "running"}>
          {phase === "running" ? (detail || "Working…") : `Claim ${formatUiAmount(props.claimableUi, props.decimals)} ${props.symbol}`}
        </button>
      )}
      {!props.isRecipient && isConnected && (
        <p className="muted" style={{ fontSize: 12, textAlign: "center", margin: 0 }}>
          Anyone can trigger a release — funds always go to the recipient.
        </p>
      )}
      {error && <p className="field-error" style={{ textAlign: "center" }}>{error}</p>}
    </div>
  );
}

function RevokeAction({ id, onDone }: { id: bigint; onDone: () => void }) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useOwnPayTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);

  async function revoke() {
    if (!publicClient) return;
    setError(undefined);
    setBusy(true);
    try {
      const h = await writeContractAsync({
        address: STOCK_VESTING_ADDRESS as Address,
        abi: stockVestingAbi,
        functionName: "revoke",
        args: [id],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      onDone();
      setConfirm(false);
    } catch (e) {
      setError(friendlyTxError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ borderColor: "color-mix(in srgb, var(--danger) 25%, var(--hairline))" }}>
      <div className="spread">
        <div>
          <div style={{ fontWeight: 550, fontSize: 14 }}>Revoke unvested</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Returns only the unvested portion to you.</div>
        </div>
        {confirm ? (
          <div className="row">
            <button className="btn btn-ghost" style={{ minHeight: 38, padding: "6px 12px" }} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
            <button className="btn btn-danger" style={{ minHeight: 38, padding: "6px 12px" }} onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Confirm"}</button>
          </div>
        ) : (
          <button className="btn btn-danger" style={{ minHeight: 38, padding: "6px 12px" }} onClick={() => setConfirm(true)}>Revoke</button>
        )}
      </div>
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel" style={{ textAlign: "center", marginTop: 32 }}>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
      <p className="soft" style={{ fontSize: 14, marginTop: 8 }}>{body}</p>
      <Link href="/" className="btn btn-ghost" style={{ marginTop: 16 }}>Go to OwnPay</Link>
    </div>
  );
}
