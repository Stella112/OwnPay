"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { SUPPORTED_TOKENS, tokenBySymbol, hasConfiguredTokens } from "@/lib/tokens";
import { erc20Abi } from "@/lib/contracts";
import { getDecimals, rawToUi, uiToRaw } from "@/lib/b20";
import { parseUiAmount, formatUiAmount } from "@/lib/format";
import { encodeMemo, isMemoValid, memoByteLength, MEMO_MAX_BYTES } from "@/lib/memo";
import { resolveRecipient, shortAddress, type ResolvedRecipient } from "@/lib/recipient";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { useEligibility } from "@/components/Eligibility";
import { WalletButton } from "@/components/WalletButton";
import { TxSteps, type TxStep } from "@/components/TxSteps";
import { friendlyTxError } from "@/components/GrantComposer";
import { BASESCAN_TX } from "@/lib/explorer";

type Review = {
  token: Address;
  symbol: string;
  decimals: number;
  recipient: ResolvedRecipient;
  rawAmount: bigint;
  effectiveUi: bigint;
  rounded: boolean;
  memo: string;
};

export function TipComposer({
  initialRecipient = "",
  lockedRecipient = false,
}: {
  initialRecipient?: string;
  lockedRecipient?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { requireEligibility } = useEligibility();

  const [symbol, setSymbol] = useState(SUPPORTED_TOKENS[0]?.symbol ?? "");
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const [phase, setPhase] = useState<"form" | "review" | "running" | "done">("form");
  const [formError, setFormError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [steps, setSteps] = useState<TxStep[]>([]);

  const memoBytes = memoByteLength(memo);
  const memoOk = isMemoValid(memo);
  // Tip is a direct B20 transfer and does not depend on the vesting escrow.
  const configured = hasConfiguredTokens();
  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  const doneHash = useMemo(() => steps.find((s) => s.key === "tip")?.hash, [steps]);

  function reset() {
    setPhase("form");
    setReview(null);
    setSteps([]);
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
    if (!token) return setFormError("Choose a supported asset.");
    if (!memoOk) return setFormError("Memo is too long. Shorten it before continuing.");

    try {
      const res = await resolveRecipient(publicClient, recipient);
      if (!res.ok) return setFormError(res.message);

      const decimals = await getDecimals(publicClient, token.address);
      let uiAmount: bigint;
      try {
        uiAmount = parseUiAmount(amount, decimals);
      } catch (e) {
        return setFormError((e as Error).message);
      }
      const rawAmount = await uiToRaw(publicClient, token.address, uiAmount);
      if (rawAmount <= 0n) return setFormError("Amount is too small for this asset.");
      const effectiveUi = await rawToUi(publicClient, token.address, rawAmount);

      const balance = (await publicClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (balance < rawAmount) {
        return setFormError(`Not enough ${token.symbol}.`);
      }

      // Official Coinbase B20 stocks expose this native function. Tip must never
      // route through the vesting escrow or require an approval.
      const native = await supportsNativeMemo(publicClient, token.address, address, res.value.address, rawAmount);
      if (!native) return setFormError(`${token.symbol} does not expose the required transferWithMemo function.`);

      setReview({
        token: token.address,
        symbol: token.symbol,
        decimals,
        recipient: res.value,
        rawAmount,
        effectiveUi,
        rounded: effectiveUi !== uiAmount,
        memo,
      });
      setPhase("review");
    } catch (e) {
      setFormError((e as Error).message ?? "Something went wrong.");
    }
  }

  async function onConfirm() {
    if (!review || !publicClient || !address) return;
    setPhase("running");

    const memoHex = encodeMemo(review.memo);
    const list: TxStep[] = [];
    list.push({ key: "tip", label: `Send ${review.symbol} tip`, status: "pending" });
    setSteps(list);
    const update = (key: string, patch: Partial<TxStep>) =>
      setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    try {
      update("tip", { status: "active", detail: "Waiting for wallet…" });
      const hash = await writeContractAsync({
        address: review.token,
        abi: erc20Abi,
        functionName: "transferWithMemo",
        args: [review.recipient.address, review.rawAmount, memoHex],
      });
      update("tip", { detail: "Confirming on Base…", hash });
      await publicClient.waitForTransactionReceipt({ hash });
      update("tip", { status: "done", detail: "Sent" });
      setPhase("done");
    } catch (e) {
      const msg = friendlyTxError(e);
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.status === "active");
        return i === -1 ? prev : prev.map((s, idx) => (idx === i ? { ...s, status: "error", detail: msg } : s));
      });
    }
  }

  if (!configured) {
    return (
      <div className="panel">
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Not configured yet</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          No verified token addresses are configured yet.
        </p>
      </div>
    );
  }

  if (phase === "done" && review) {
    return (
      <div className="panel stack" style={{ ["--gap" as string]: "16px" }}>
        <span className="pill pill-accent" style={{ alignSelf: "flex-start" }}><span className="dot" /> Tip sent on Base</span>
        <h2 style={{ fontSize: 20 }}>{formatUiAmount(review.effectiveUi, review.decimals)} {review.symbol} sent</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          {review.recipient.name ?? shortAddress(review.recipient.address)} received your stock tip{review.memo ? ` with the memo “${review.memo}”.` : "."}
        </p>
        <TxSteps steps={steps} />
        {doneHash && (
          <a className="btn btn-ghost btn-block" href={BASESCAN_TX(doneHash)} target="_blank" rel="noopener noreferrer">
            View on Basescan ↗
          </a>
        )}
        <button className="btn btn-primary btn-block" onClick={reset}>Send another</button>
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
                <button key={t.symbol} type="button" className="choice" data-selected={symbol === t.symbol} onClick={() => setSymbol(t.symbol)}>
                  <div className="k">{t.symbol}</div>
                  <div className="v">{t.name}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="t-recipient">Recipient</label>
            <input id="t-recipient" className="input" placeholder="0x… or name.base.eth" value={recipient}
              onChange={(e) => setRecipient(e.target.value)} readOnly={lockedRecipient} aria-readonly={lockedRecipient} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            {lockedRecipient && <div className="field-hint">Recipient fixed by this OwnPay Link.</div>}
          </div>
          <div>
            <label htmlFor="t-amount">Amount ({symbol})</label>
            <input id="t-amount" className="input tnum" inputMode="decimal" placeholder="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label htmlFor="t-memo">Memo (optional)</label>
            <input id="t-memo" className="input" placeholder="thanks!" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={140} />
            <div className={memoOk ? "field-hint" : "field-error"}>{memoBytes}/{MEMO_MAX_BYTES} bytes{!memoOk && " — too long"}</div>
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
            <button className="btn btn-primary btn-block" onClick={onReview} disabled={!recipient || !amount}>Review</button>
          )}
        </>
      )}

      {phase === "review" && review && (
        <div className="panel stack" style={{ ["--gap" as string]: "14px" }}>
          <h2 style={{ fontSize: 18 }}>Confirm tip</h2>
          <dl className="meta">
            <dt>Asset</dt><dd>{review.symbol}</dd>
            <dt>To</dt><dd className="tnum">{review.recipient.name ?? shortAddress(review.recipient.address)}</dd>
            <dt>Amount</dt><dd className="tnum">{formatUiAmount(review.effectiveUi, review.decimals)} {review.symbol}</dd>
            {review.memo && (<><dt>Memo</dt><dd>{review.memo}</dd></>)}
            <dt>Method</dt><dd>Direct B20 transfer with memo</dd>
          </dl>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setPhase("form")}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onConfirm}>Send tip</button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="panel stack" style={{ ["--gap" as string]: "16px" }}>
          <h2 style={{ fontSize: 18 }}>Sending tip</h2>
          <TxSteps steps={steps} />
          {steps.some((s) => s.status === "error") && (
            <button className="btn btn-ghost btn-block" onClick={() => setPhase("review")}>Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

async function supportsNativeMemo(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  token: Address,
  account: Address,
  to: Address,
  amount: bigint,
): Promise<boolean> {
  try {
    await client.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: "transferWithMemo",
      args: [to, amount, encodeMemo("")],
      account,
    });
    return true;
  } catch {
    return false;
  }
}
