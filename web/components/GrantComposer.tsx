"use client";

import { useMemo, useState } from "react";
import { decodeEventLog, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import Link from "next/link";
import { SUPPORTED_TOKENS, tokenBySymbol, hasConfiguredTokens } from "@/lib/tokens";
import { STOCK_VESTING_ADDRESS, stockVestingAbi, erc20Abi, isVestingConfigured } from "@/lib/contracts";
import { getDecimals, rawToUi, uiToRaw } from "@/lib/b20";
import { parseUiAmount, formatUiAmount } from "@/lib/format";
import { encodeMemo, isMemoValid, memoByteLength, MEMO_MAX_BYTES } from "@/lib/memo";
import { resolveRecipient, shortAddress, type ResolvedRecipient } from "@/lib/recipient";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { useEligibility } from "@/components/Eligibility";
import { WalletButton } from "@/components/WalletButton";
import { TxSteps, type TxStep } from "@/components/TxSteps";
import { BASESCAN_TX } from "@/lib/explorer";

type Mode = "pay" | "gift";

type Preset = { key: string; label: string; cliff: number; duration: number };

const PAY_PRESETS: Preset[] = [
  { key: "demo", label: "Demo · 15s cliff, 60s vest", cliff: 15, duration: 60 },
  { key: "std", label: "Standard · 3mo cliff, 12mo vest", cliff: 90 * 86400, duration: 365 * 86400 },
];
// Gift is all-or-nothing: cliff == duration (unlock at end).
const GIFT_PRESETS: Preset[] = [
  { key: "demo", label: "Demo · unlocks in 60s", cliff: 60, duration: 60 },
  { key: "m1", label: "Unlocks in 30 days", cliff: 30 * 86400, duration: 30 * 86400 },
  { key: "y1", label: "Unlocks in 1 year", cliff: 365 * 86400, duration: 365 * 86400 },
];

type Review = {
  token: Address;
  symbol: string;
  decimals: number;
  recipient: ResolvedRecipient;
  uiAmount: bigint;
  rawAmount: bigint;
  effectiveUi: bigint;
  rounded: boolean;
  needApprove: boolean;
  preset: Preset;
  memo: string;
};

export function GrantComposer({ mode }: { mode: Mode }) {
  const isPay = mode === "pay";
  const presets = isPay ? PAY_PRESETS : GIFT_PRESETS;

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { requireEligibility } = useEligibility();

  const [symbol, setSymbol] = useState(SUPPORTED_TOKENS[0]?.symbol ?? "");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [presetKey, setPresetKey] = useState(presets[0].key);

  const [phase, setPhase] = useState<"form" | "review" | "running" | "done">("form");
  const [formError, setFormError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [grantId, setGrantId] = useState<bigint | null>(null);

  const memoBytes = memoByteLength(memo);
  const memoOk = isMemoValid(memo);
  const preset = useMemo(() => presets.find((p) => p.key === presetKey) ?? presets[0], [presets, presetKey]);

  const configured = isVestingConfigured() && hasConfiguredTokens();
  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  function reset() {
    setPhase("form");
    setReview(null);
    setSteps([]);
    setGrantId(null);
    setFormError(null);
  }

  async function onReview() {
    setFormError(null);
    if (!requireEligibility()) return;
    if (!publicClient || !address) {
      setFormError("Connect your wallet first.");
      return;
    }
    const token = tokenBySymbol(symbol);
    if (!token) {
      setFormError("Choose a supported asset.");
      return;
    }
    if (!memoOk) {
      setFormError("Memo is too long. Shorten it before continuing.");
      return;
    }
    try {
      const res = await resolveRecipient(publicClient, recipient);
      if (!res.ok) {
        setFormError(res.message);
        return;
      }
      const decimals = await getDecimals(publicClient, token.address);
      let uiAmount: bigint;
      try {
        uiAmount = parseUiAmount(amount, decimals);
      } catch (e) {
        setFormError((e as Error).message);
        return;
      }
      const rawAmount = await uiToRaw(publicClient, token.address, uiAmount);
      if (rawAmount <= 0n) {
        setFormError("Amount is too small for this asset.");
        return;
      }
      const effectiveUi = await rawToUi(publicClient, token.address, rawAmount);

      // Balance check (RAW).
      const balance = (await publicClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (balance < rawAmount) {
        setFormError(`Not enough ${token.symbol}. You hold ${formatUiAmount(await rawToUi(publicClient, token.address, balance), decimals)}.`);
        return;
      }

      // Allowance check (RAW).
      const allowance = (await publicClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, STOCK_VESTING_ADDRESS as Address],
      })) as bigint;

      setReview({
        token: token.address,
        symbol: token.symbol,
        decimals,
        recipient: res.value,
        uiAmount,
        rawAmount,
        effectiveUi,
        rounded: effectiveUi !== uiAmount,
        needApprove: allowance < rawAmount,
        preset,
        memo,
      });
      setPhase("review");
    } catch (e) {
      setFormError((e as Error).message ?? "Something went wrong preparing the grant.");
    }
  }

  async function onConfirm() {
    if (!review || !publicClient || !address) return;
    setPhase("running");

    const base: TxStep[] = [];
    if (review.needApprove) base.push({ key: "approve", label: `Approve ${review.symbol} for escrow`, status: "pending" });
    base.push({ key: "create", label: isPay ? "Create vesting grant" : "Create stock gift", status: "pending" });
    setSteps(base);

    const update = (key: string, patch: Partial<TxStep>) =>
      setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    try {
      if (review.needApprove) {
        update("approve", { status: "active", detail: "Waiting for wallet…" });
        const approveHash = await writeContractAsync({
          address: review.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [STOCK_VESTING_ADDRESS as Address, review.rawAmount],
        });
        update("approve", { detail: "Confirming on Base…", hash: approveHash });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        update("approve", { status: "done", detail: "Approved" });
      }

      update("create", { status: "active", detail: "Waiting for wallet…" });
      const start = Math.floor(Date.now() / 1000);
      const createHash = await writeContractAsync({
        address: STOCK_VESTING_ADDRESS as Address,
        abi: stockVestingAbi,
        functionName: "createGrant",
        args: [
          review.token,
          review.recipient.address,
          review.rawAmount,
          BigInt(start),
          BigInt(start + review.preset.cliff),
          BigInt(review.preset.duration),
          isPay, // revocable
          encodeMemo(review.memo),
        ],
      });
      update("create", { detail: "Confirming on Base…", hash: createHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

      // Read the grant id from the GrantCreated event (never grantCount - 1).
      const id = decodeGrantId(receipt.logs);
      if (id === null) {
        update("create", { status: "error", detail: "Grant created, but the id couldn't be read from the receipt." });
        return;
      }
      update("create", { status: "done", detail: `Grant #${id.toString()} created` });
      setGrantId(id);
      setPhase("done");
    } catch (e) {
      const msg = friendlyTxError(e);
      setSteps((prev) => {
        const activeIdx = prev.findIndex((s) => s.status === "active");
        if (activeIdx === -1) return prev;
        return prev.map((s, i) => (i === activeIdx ? { ...s, status: "error", detail: msg } : s));
      });
    }
  }

  if (!configured) {
    return (
      <div className="panel">
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Not configured yet</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          {isVestingConfigured()
            ? "No official token addresses are configured. Add verified AAPLc/NVDAc addresses to the allowlist."
            : "The StockVesting contract address isn't set. Deploy it and set NEXT_PUBLIC_STOCK_VESTING_ADDRESS."}
        </p>
      </div>
    );
  }

  if (phase === "done" && grantId !== null) {
    const claimPath = `/claim/${grantId.toString()}`;
    return (
      <div className="panel stack" style={{ ["--gap" as string]: "16px" }}>
        <span className="pill pill-accent" style={{ alignSelf: "flex-start" }}>
          <span className="dot" /> {isPay ? "Grant created" : "Gift created"} on Base
        </span>
        <h2 style={{ fontSize: 20 }}>Share the claim link</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          {review?.recipient.name ?? shortAddress(review!.recipient.address)} can open this to watch it vest and claim.
        </p>
        <div className="panel" style={{ background: "var(--surface-sunken)", padding: 14, borderRadius: 12, wordBreak: "break-all" }}>
          <Link href={claimPath} className="tnum" style={{ fontSize: 14 }}>{claimPath}</Link>
        </div>
        <TxSteps steps={steps} />
        <div className="row">
          <Link className="btn btn-primary btn-block" href={claimPath}>Open claim page</Link>
        </div>
        <button className="btn btn-ghost btn-block" onClick={reset}>Create another</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ ["--gap" as string]: "18px" }}>
      {phase === "form" && (
        <>
          <div>
            <label>Asset</label>
            <div className="choice-grid">
              {SUPPORTED_TOKENS.map((t) => (
                <button
                  key={t.symbol}
                  type="button"
                  className="choice"
                  data-selected={symbol === t.symbol}
                  onClick={() => setSymbol(t.symbol)}
                >
                  <div className="k">{t.symbol}</div>
                  <div className="v">{t.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="recipient">Recipient</label>
            <input
              id="recipient"
              className="input"
              placeholder="0x… or name.base.eth"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label htmlFor="amount">Amount ({symbol})</label>
            <input
              id="amount"
              className="input tnum"
              inputMode="decimal"
              placeholder="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="schedule">{isPay ? "Vesting schedule" : "Unlock"}</label>
            <select id="schedule" className="select input" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            {preset.key === "demo" && (
              <div className="field-hint">Demo schedule — unusually short, for live recording.</div>
            )}
          </div>

          <div>
            <label htmlFor="memo">Memo (optional)</label>
            <input
              id="memo"
              className="input"
              placeholder={isPay ? "2026 contributor" : "Happy birthday"}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={140}
            />
            <div className={memoOk ? "field-hint" : "field-error"}>
              {memoBytes}/{MEMO_MAX_BYTES} bytes{!memoOk && " — too long"}
            </div>
          </div>

          {formError && <div className="field-error" role="alert">{formError}</div>}

          {!isConnected ? (
            <div className="stack" style={{ ["--gap" as string]: "8px" }}>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Connect a wallet to continue.</p>
              <WalletButton />
            </div>
          ) : wrongNetwork ? (
            <button className="btn btn-primary btn-block" disabled>Switch to Base to continue</button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={onReview} disabled={!recipient || !amount}>
              Review
            </button>
          )}
        </>
      )}

      {phase === "review" && review && (
        <div className="panel stack" style={{ ["--gap" as string]: "14px" }}>
          <h2 style={{ fontSize: 18 }}>Confirm {isPay ? "grant" : "gift"}</h2>
          <dl className="meta">
            <dt>Asset</dt><dd>{review.symbol}</dd>
            <dt>To</dt><dd className="tnum">{review.recipient.name ?? shortAddress(review.recipient.address)}</dd>
            <dt>Amount</dt>
            <dd className="tnum">{formatUiAmount(review.effectiveUi, review.decimals)} {review.symbol}</dd>
            <dt>{isPay ? "Schedule" : "Unlock"}</dt><dd>{review.preset.label}</dd>
            {review.memo && (<><dt>Memo</dt><dd>{review.memo}</dd></>)}
            <dt>Revocable</dt><dd>{isPay ? "Yes (employer)" : "No"}</dd>
          </dl>
          {review.rounded && (
            <div className="field-hint">
              Rounded to the asset&apos;s precision: {formatUiAmount(review.effectiveUi, review.decimals)} {review.symbol}.
            </div>
          )}
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setPhase("form")}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onConfirm}>
              {review.needApprove ? "Approve & create" : isPay ? "Create grant" : "Send gift"}
            </button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="panel stack" style={{ ["--gap" as string]: "16px" }}>
          <h2 style={{ fontSize: 18 }}>{isPay ? "Creating grant" : "Creating gift"}</h2>
          <TxSteps steps={steps} />
          {steps.some((s) => s.status === "error") && (
            <button className="btn btn-ghost btn-block" onClick={() => setPhase("review")}>Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

function decodeGrantId(logs: readonly { address: string; topics: string[]; data: Hex }[]): bigint | null {
  for (const log of logs) {
    try {
      const parsed = decodeEventLog({ abi: stockVestingAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (parsed.eventName === "GrantCreated") {
        return (parsed.args as unknown as { id: bigint }).id;
      }
    } catch {
      /* not our event */
    }
  }
  return null;
}

export function friendlyTxError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string };
  const raw = err.shortMessage || err.message || "Transaction failed.";
  if (/user rejected|denied|rejected the request/i.test(raw)) return "You rejected the request in your wallet.";
  if (/insufficient funds/i.test(raw)) return "Insufficient ETH for gas on Base.";
  return raw;
}

export { BASESCAN_TX };
