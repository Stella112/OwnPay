'use client';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { encodeFunctionData, erc20Abi, isAddress, parseUnits } from 'viem';
import { ownRulesAbi, TEST_USDG } from '@/lib/robinhood';
import { rhChain, useRh } from '@/components/robinhood/session';
import { ActivityList, Field, RhPageHeader, styles } from '@/components/robinhood/ui';

export default function PayPage() {
  return <Suspense fallback={null}><PayView /></Suspense>;
}

function PayView() {
  const q = useSearchParams();
  const { owner, snapshot, busy, run, sendCalls, commitment, smartAccount, history } = useRh();
  const [recipient, setRecipient] = useState(q.get('to') || '');
  const [amount, setAmount] = useState(q.get('amount') || '1');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const disabled = busy || !owner || !snapshot;
  // Does the recipient use OwnPay? Rule-holders get the split + their own policy; anyone else gets a plain transfer.
  const target = useQuery({
    queryKey: ['rh-recipient', snapshot?.router, recipient, owner],
    enabled: !!snapshot && isAddress(recipient),
    queryFn: async () => {
      const r = recipient as `0x${string}`;
      const [rule, policy, myStatus] = await Promise.all([
        rhChain.readContract({ address: snapshot!.router, abi: ownRulesAbi, functionName: 'rules', args: [r] }),
        rhChain.readContract({ address: snapshot!.router, abi: ownRulesAbi, functionName: 'policies', args: [r] }),
        owner ? rhChain.readContract({ address: snapshot!.router, abi: ownRulesAbi, functionName: 'senderStatus', args: [r, owner] }) : Promise.resolve(0),
      ]);
      return { usesOwnPay: rule[5], savings: rule[0], ownership: rule[1], max: rule[2], allowlistOnly: policy[0], requireMemo: policy[1], blocked: myStatus === 2, allowed: myStatus === 1 };
    },
  });
  const t = target.data;
  const preview = !t ? null
    : !t.usesOwnPay ? 'Not on OwnPay: this is a plain USDG transfer to their wallet. No split, no restrictions.'
    : t.blocked ? 'This recipient has blocked your address. The payment will be rejected.'
    : t.allowlistOnly && !t.allowed ? 'This recipient only accepts approved senders, and you are not on their list.'
    : `Uses OwnPay: their rule splits it ${100 - (t.savings + t.ownership) / 100}% spendable · ${t.savings / 100}% savings · ${t.ownership / 100}% ownership${t.requireMemo ? '. A note is required.' : '.'}`;

  async function pay() {
    if (!snapshot || !owner) throw new Error('Sign in first.');
    if (!isAddress(recipient)) throw new Error('Enter the recipient’s Robinhood testnet address.');
    let raw: bigint; try { raw = parseUnits(amount.trim(), 6); } catch { throw new Error('Enter a valid amount.'); }
    if (raw <= 0n) throw new Error('Amount must be greater than zero.');
    const rule = await rhChain.readContract({ address: snapshot.router, abi: ownRulesAbi, functionName: 'rules', args: [recipient] });
    if (!rule[5]) { // recipient has not opted in to OwnPay: plain transfer
      await sendCalls([{ to: TEST_USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, raw] }) }]);
      return;
    }
    const allowance = await rhChain.readContract({ address: TEST_USDG, abi: erc20Abi, functionName: 'allowance', args: [owner, snapshot.router] });
    const memo = note.trim() ? await commitment(note) : `0x${'00'.repeat(32)}` as const;
    const calls = [];
    if (allowance < raw) calls.push({ to: TEST_USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [snapshot.router, raw] }) });
    calls.push({ to: snapshot.router, data: encodeFunctionData({ abi: ownRulesAbi, functionName: 'pay', args: [recipient, raw, memo] }) });
    await sendCalls(calls);
  }

  const sent = history.filter((i) => i.kind === 'payment_sent' || i.kind === 'payment_received');
  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Pay" title="Send USDG" subtitle="Pay any address. If the recipient uses OwnPay, their rule splits it the moment it lands and their own payment policy applies." />
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Send test USDG</p><h2>Pay someone</h2></div><span className="pill pill-muted">{smartAccount ? 'Gas sponsored' : 'You pay gas'}</span></div>
        <div className={styles.formStack}>
          <Field label="Recipient address" value={recipient} onChange={(v) => setRecipient(v.trim())} placeholder="0x…" mono />
          {preview && <div className={styles.notice}>{preview}</div>}
          <Field label="Amount · USDG" value={amount} onChange={setAmount} mono />
          <Field label="Note (optional)" value={note} onChange={setNote} hint="Encrypted in your browser; only a commitment goes on chain. Some recipients require a note." />
        </div>
        <button className="btn btn-primary" disabled={disabled} onClick={() => void run(pay)}>Pay</button>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Get paid</p><h2>Your payment link</h2></div></div>
        <p className={styles.softText}>Share a link that opens this page with your address and amount filled in.</p>
        <div className={styles.buttonRow}><button className="btn" disabled={!owner} onClick={() => setLink(`${window.location.origin}/robinhood/pay?to=${owner}&amount=${encodeURIComponent(amount)}`)}>Create link</button></div>
        {link && <div className={styles.shareLink}><a href={link}>{link}</a><button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(link)}>Copy</button></div>}
        <hr className="divide" />
        <h3>Recent payments</h3>
        <ActivityList items={sent.slice(0, 5)} empty="No payments yet." />
      </article>
    </div>
  </div>;
}
