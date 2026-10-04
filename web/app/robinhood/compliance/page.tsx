'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { encodeAbiParameters, isAddress, parseUnits, type Address } from 'viem';
import { ownRulesAbi } from '@/lib/robinhood';
import { rhChain, useRh } from '@/components/robinhood/session';
import { Field, RhPageHeader, short, styles, usdg } from '@/components/robinhood/ui';

const STATUS = ['Not listed', 'Allowed', 'Blocked'];

export default function CompliancePage() {
  const { owner, snapshot, history, busy, run, signed } = useRh();
  const policy = snapshot?.policy;
  const [allowlistOnly, setAllowlistOnly] = useState(!!policy?.[0]);
  const [requireMemo, setRequireMemo] = useState(!!policy?.[1]);
  const [cap, setCap] = useState(policy && policy[2] !== '0' ? usdg(policy[2]).replace(/,/g, '') : '');
  const [sender, setSender] = useState('');
  const disabled = busy || !owner || !snapshot;

  // Senders ever listed (from your own SenderStatusChanged events), re-read live from the contract.
  const listed = [...new Set(history.filter((i) => i.kind === 'sender_status').map((i) => String(i.data.sender)))] as Address[];
  const statuses = useQuery({
    queryKey: ['rh-senders', owner, listed.join(',')],
    enabled: !!owner && !!snapshot && listed.length > 0,
    queryFn: () => Promise.all(listed.map(async (s) => ({ sender: s, status: Number(await rhChain.readContract({ address: snapshot!.router, abi: ownRulesAbi, functionName: 'senderStatus', args: [owner!, s] })) }))),
  });

  const savePolicy = () => run(() => {
    const capRaw = cap.trim() ? parseUnits(cap.trim(), 6) : 0n;
    return signed(5, encodeAbiParameters([{ type: 'bool' }, { type: 'bool' }, { type: 'uint128' }], [allowlistOnly, requireMemo, capRaw]));
  });
  const setStatus = (who: string, status: number) => run(() => {
    if (!isAddress(who)) throw new Error('Enter a valid address.');
    return signed(6, encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }], [who, status]));
  });

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Compliance" title="You decide who can pay you" subtitle="Your payment policy is enforced by the OwnRules contract on every payment. No administrator can approve or block anyone on your behalf." />
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Your policy</p><h2>Payment rules</h2></div><span className="pill pill-muted">{policy ? (policy[0] ? 'Allowlist only' : 'Open') : '—'}</span></div>
        <label className={styles.checkboxRow}><input type="checkbox" checked={allowlistOnly} onChange={(e) => setAllowlistOnly(e.target.checked)} /><span><strong>Only accept payments from senders I allow</strong><small>Everyone else is rejected on chain. Direct deposits to your receive account can’t prove who sent them, so they are held for you to recover instead of being split.</small></span></label>
        <label className={styles.checkboxRow}><input type="checkbox" checked={requireMemo} onChange={(e) => setRequireMemo(e.target.checked)} /><span><strong>Require a payment note</strong><small>Payments without a note (e.g. an invoice reference) are rejected.</small></span></label>
        <Field label="Daily limit per sender · USDG (blank = none)" value={cap} onChange={setCap} mono hint="Caps how much any single sender can pay you per day." />
        <button className="btn btn-primary" disabled={disabled} onClick={() => void savePolicy()}>Save policy</button>
        <p className={styles.fieldHint}>Your overall max-per-payment and daily limit live on the Rules page. This is not identity verification (KYC) or sanctions screening.</p>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Senders</p><h2>Allow and block list</h2></div></div>
        <Field label="Sender address" value={sender} onChange={(v) => setSender(v.trim())} placeholder="0x…" mono />
        <div className={styles.buttonRow}>
          <button className="btn btn-primary" disabled={disabled || !sender} onClick={() => void setStatus(sender, 1)}>Allow</button>
          <button className="btn btn-danger" disabled={disabled || !sender} onClick={() => void setStatus(sender, 2)}>Block</button>
        </div>
        <hr className="divide" />
        {!listed.length ? <div className={styles.emptyState}>No senders listed yet.</div>
          : <div className={styles.activityList}>{(statuses.data ?? listed.map((s) => ({ sender: s, status: -1 }))).map((s) => (
            <article className={styles.activityItem} key={s.sender}>
              <div className={styles.activityTitle}><strong className={styles.mono}>{short(s.sender)}</strong><span className={`pill ${s.status === 2 ? 'pill-danger' : s.status === 1 ? 'pill-accent' : 'pill-muted'}`}>{s.status < 0 ? '…' : STATUS[s.status]}</span></div>
              <div className={styles.buttonRow}>
                {s.status !== 1 && <button className="btn btn-ghost" disabled={disabled} onClick={() => void setStatus(s.sender, 1)}>Allow</button>}
                {s.status !== 2 && <button className="btn btn-ghost" disabled={disabled} onClick={() => void setStatus(s.sender, 2)}>Block</button>}
                {s.status > 0 && <button className="btn btn-ghost" disabled={disabled} onClick={() => void setStatus(s.sender, 0)}>Remove</button>}
              </div>
            </article>))}</div>}
      </article>
    </div>
  </div>;
}
