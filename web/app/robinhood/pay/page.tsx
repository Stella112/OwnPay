'use client';
import { Suspense, useState } from 'react';
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

  async function pay() {
    if (!snapshot || !owner) throw new Error('Sign in first.');
    if (!isAddress(recipient)) throw new Error('Enter the recipient’s Robinhood testnet address.');
    let raw: bigint; try { raw = parseUnits(amount.trim(), 6); } catch { throw new Error('Enter a valid amount.'); }
    if (raw <= 0n) throw new Error('Amount must be greater than zero.');
    const allowance = await rhChain.readContract({ address: TEST_USDG, abi: erc20Abi, functionName: 'allowance', args: [owner, snapshot.router] });
    const memo = note.trim() ? await commitment(note) : `0x${'00'.repeat(32)}` as const;
    const calls = [];
    if (allowance < raw) calls.push({ to: TEST_USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [snapshot.router, raw] }) });
    calls.push({ to: snapshot.router, data: encodeFunctionData({ abi: ownRulesAbi, functionName: 'pay', args: [recipient, raw, memo] }) });
    await sendCalls(calls);
  }

  const sent = history.filter((i) => i.kind === 'payment_sent' || i.kind === 'payment_received');
  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Pay" title="Send USDG" subtitle="The recipient’s rule splits your payment the moment it lands. Their payment policy decides whether they accept it." />
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Send test USDG</p><h2>Pay someone</h2></div><span className="pill pill-muted">{smartAccount ? 'Gas sponsored' : 'You pay gas'}</span></div>
        <div className={styles.formStack}>
          <Field label="Recipient address" value={recipient} onChange={(v) => setRecipient(v.trim())} placeholder="0x…" mono />
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
