"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/contracts";
import { getDecimals } from "@/lib/b20";
import { formatUiAmount, parseUiAmount } from "@/lib/format";
import { resolveRecipient, shortAddress, type ResolvedRecipient } from "@/lib/recipient";
import { BASESCAN_TX } from "@/lib/explorer";
import { BASE_USDC_ADDRESS } from "@/lib/stablecoins";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { useEligibility } from "@/components/Eligibility";
import { WalletButton } from "@/components/WalletButton";
import { TxSteps, type TxStep } from "@/components/TxSteps";
import { useOwnPayTransaction } from "@/components/OwnPayTransactionProvider";

type PaymentReview = {
  recipient: ResolvedRecipient;
  decimals: number;
  rawAmount: bigint;
  displayAmount: string;
};

export function UsdcPaymentComposer({
  initialRecipient = "",
  lockedRecipient = false,
}: {
  initialRecipient?: string;
  lockedRecipient?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useOwnPayTransaction();
  const { requireEligibility } = useEligibility();
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"form" | "review" | "running" | "done">("form");
  const [review, setReview] = useState<PaymentReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<TxStep[]>([]);
  const doneHash = useMemo(() => steps.find((step) => step.key === "usdc")?.hash, [steps]);
  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  async function prepare() {
    setError(null);
    if (!requireEligibility()) return;
    if (!publicClient || !address) return setError("Sign in first.");
    try {
      const resolved = await resolveRecipient(publicClient, recipient);
      if (!resolved.ok) return setError(resolved.message);
      const decimals = await getDecimals(publicClient, BASE_USDC_ADDRESS);
      const rawAmount = parseUiAmount(amount, decimals);
      const balance = (await publicClient.readContract({
        address: BASE_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (balance < rawAmount) {
        return setError(`Not enough USDC. You hold ${formatUiAmount(balance, decimals)} USDC.`);
      }
      setReview({
        recipient: resolved.value,
        decimals,
        rawAmount,
        displayAmount: formatUiAmount(rawAmount, decimals),
      });
      setPhase("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the USDC payment.");
    }
  }

  async function confirm() {
    if (!review || !publicClient) return;
    setPhase("running");
    setSteps([{ key: "usdc", label: "Send USDC", status: "active", detail: "Waiting for wallet…" }]);
    try {
      const hash = await writeContractAsync({
        address: BASE_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [review.recipient.address, review.rawAmount],
      });
      setSteps([{ key: "usdc", label: "Send USDC", status: "active", detail: "Confirming on Base…", hash }]);
      await publicClient.waitForTransactionReceipt({ hash });
      setSteps([{ key: "usdc", label: "Send USDC", status: "done", detail: "Confirmed", hash }]);
      setPhase("done");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The USDC payment was not confirmed.";
      setSteps([{ key: "usdc", label: "Send USDC", status: "error", detail: message }]);
    }
  }

  function reset() {
    setPhase("form");
    setReview(null);
    setSteps([]);
    setError(null);
  }

  if (phase === "done" && review && doneHash) {
    return (
      <div className="panel stack" style={{ ["--gap" as string]: "16px" }}>
        <span className="pill pill-accent" style={{ alignSelf: "flex-start" }}><span className="dot" /> Payment sent</span>
        <h2 style={{ fontSize: 20 }}>${review.displayAmount} USDC</h2>
        <dl className="meta">
          <dt>To</dt><dd>{review.recipient.name ?? shortAddress(review.recipient.address)}</dd>
          <dt>Network</dt><dd>Base</dd>
          <dt>Transaction</dt><dd className="tnum">{shortAddress(doneHash)}</dd>
        </dl>
        <a className="btn btn-ghost btn-block" href={BASESCAN_TX(doneHash)} target="_blank" rel="noopener noreferrer">View on Basescan ↗</a>
        <button className="btn btn-primary btn-block" onClick={reset}>Send another</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ ["--gap" as string]: "18px" }}>
      {phase === "form" && <>
        <div>
          <label htmlFor="usdc-recipient">Recipient</label>
          <input id="usdc-recipient" className="input" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x… or name.base.eth" readOnly={lockedRecipient} aria-readonly={lockedRecipient} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {lockedRecipient && <div className="field-hint">Recipient fixed by this OwnPay Link.</div>}
        </div>
        <div>
          <label htmlFor="usdc-amount">Amount (USDC)</label>
          <input id="usdc-amount" className="input tnum" inputMode="decimal" placeholder="100.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <div className="field-hint">Canonical native USDC on Base.</div>
        </div>
        {error && <div className="field-error" role="alert">{error}</div>}
        {!isConnected ? <div className="stack" style={{ ["--gap" as string]: "8px" }}><p className="muted" style={{ margin: 0, fontSize: 13 }}>Sign in to continue.</p><WalletButton /></div> : wrongNetwork ? <button className="btn btn-primary btn-block" disabled>Switch to Base to continue</button> : <button className="btn btn-primary btn-block" onClick={prepare} disabled={!recipient || !amount}>Review USDC payment</button>}
      </>}
      {phase === "review" && review && <div className="panel stack" style={{ ["--gap" as string]: "14px" }}>
        <h2 style={{ fontSize: 18 }}>Confirm USDC payment</h2>
        <dl className="meta"><dt>Asset</dt><dd>USDC</dd><dt>Amount</dt><dd className="tnum">${review.displayAmount}</dd><dt>To</dt><dd>{review.recipient.name ?? shortAddress(review.recipient.address)}</dd><dt>Method</dt><dd>Direct Base USDC transfer</dd></dl>
        <div className="row"><button className="btn btn-ghost" onClick={() => setPhase("form")}>Back</button><button className="btn btn-primary" style={{ flex: 1 }} onClick={confirm}>Send payment</button></div>
      </div>}
      {phase === "running" && <div className="panel stack" style={{ ["--gap" as string]: "16px" }}><h2 style={{ fontSize: 18 }}>Sending USDC</h2><TxSteps steps={steps} />{steps.some((step) => step.status === "error") && <button className="btn btn-ghost btn-block" onClick={() => setPhase("review")}>Try again</button>}</div>}
    </div>
  );
}

export function isUsdcAddress(address: string): address is Address {
  return address.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase();
}
