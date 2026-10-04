'use client';
import Link from 'next/link';
import { useState } from 'react';
import { encodeAbiParameters, zeroAddress } from 'viem';
import { rhChain, useRh } from '@/components/robinhood/session';
import { ActivityList, RhPageHeader, short, styles, when } from '@/components/robinhood/ui';

export default function AgentPage() {
  const { owner, snapshot, history, busy, run, signed, checkedAt } = useRh();
  const [duration, setDuration] = useState('24');
  const [customDays, setCustomDays] = useState('3');
  const s = snapshot?.agentService;
  const d = snapshot?.delegation;
  const active = !!d && d[0] !== zeroAddress && Number(d[1]) * 1000 > checkedAt && d[2] === snapshot?.rule?.[4];
  const stale = !!d && d[0] !== zeroAddress && d[2] !== snapshot?.rule?.[4];
  const disabled = busy || !owner || !snapshot;
  const agentDid = history.filter((i) => (i.kind === 'income_split' && i.actor === 'agent') || i.kind === 'agent_changed');
  const splits = agentDid.filter((i) => i.kind === 'income_split');
  const status = s?.state === 'online' ? 'Online' : s?.state === 'degraded' ? 'Needs attention' : s?.state === 'stale' ? 'Heartbeat stale' : 'Not reporting';
  const delegate = (agent: `0x${string}`, expires: bigint) => run(() => signed(2, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [agent, expires])));
  const hasDelegation = !!d && d[0] !== zeroAddress;
  const authorizeBlocker = !owner ? 'Sign in first.' : !snapshot?.agent ? 'The agent is not configured on this server.' : !snapshot?.rule?.[5] ? 'Save a rule first, so the agent knows how to split.' : null;
  function authorize() {
    const hours = duration === 'custom' ? Number(customDays) * 24 : Number(duration);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('Choose how long the agent may act for.');
    if (hours > 30 * 24) throw new Error('The contract allows at most 30 days. Re-authorize when it expires.');
    // Anchor to the chain's clock (the contract checks expiry against block time).
    return rhChain.getBlock().then((b) => signed(2, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [snapshot!.agent!, b.timestamp + BigInt(Math.floor(hours * 3600))])));
  }

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Agent" title="Automation you control" subtitle="The OwnPay agent splits money sent to your receive account using your saved rule. It cannot change your rule, choose recipients, or move funds anywhere else." />
    <div className={styles.metrics}>
      <article className={styles.metric}><span>Worker</span><strong>{status}</strong><small>{s?.mode === 'execute' ? 'Execute mode' : s?.mode === 'observe' ? 'Observe only' : 'No heartbeat'}</small></article>
      <article className={styles.metric}><span>Your permission</span><strong>{active ? 'Authorized' : stale ? 'Reset by rule change' : 'Not authorized'}</strong><small>{active ? `Until ${when(Number(d![1]))}` : 'Authorize below'}</small></article>
      <article className={styles.metric}><span>Splits by agent</span><strong>{splits.length}</strong><small>On your account</small></article>
      <article className={styles.metric}><span>Last heartbeat</span><strong>{s?.updatedAt ? new Date(s.updatedAt).toLocaleTimeString() : '—'}</strong><small>{s?.trackedAccounts ?? 0} accounts watched</small></article>
    </div>
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Permission</p><h2>Agent access</h2></div><span className={`pill ${active ? 'pill-accent' : 'pill-muted'}`}>{active ? 'Active' : 'Off'}</span></div>
        <div className={styles.permissionBox}><span>Agent address</span><strong className={styles.mono}>{snapshot?.agent ? short(snapshot.agent) : 'Not configured'}</strong><small>Can only call processIncoming for your account, under rule v{snapshot?.rule?.[4] ?? '—'}, within your limits.</small></div>
        {!snapshot?.rule?.[5] && <p className={styles.inlineWarning}>Save a rule first. <Link href="/robinhood/rules">Go to Rules</Link></p>}
        {stale && <p className={styles.inlineWarning}>You changed your rule after authorizing, so the old permission no longer works. Authorize again.</p>}
        <div className={styles.fieldGrid}>
          <label className={styles.field}>Let the agent act for
            <select className="input" value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="1">1 hour</option><option value="24">1 day</option><option value="168">7 days</option><option value="720">30 days (maximum)</option><option value="custom">Custom…</option>
            </select>
          </label>
          {duration === 'custom' && <label className={styles.field}>Days (up to 30)<input className="input tnum" inputMode="decimal" value={customDays} onChange={(e) => setCustomDays(e.target.value)} /></label>}
        </div>
        <div className={styles.buttonRow}>
          <button className="btn btn-primary" disabled={busy || !!authorizeBlocker} onClick={() => void run(authorize)}>{hasDelegation ? 'Re-authorize' : 'Authorize agent'}</button>
          <button className="btn" disabled={disabled || !hasDelegation} onClick={() => void delegate(zeroAddress, 0n)}>Revoke</button>
        </div>
        {authorizeBlocker && <p className={styles.fieldHint}>{authorizeBlocker}</p>}
        {!hasDelegation && !authorizeBlocker && <p className={styles.fieldHint}>Nothing to revoke: the agent has no permission right now.</p>}
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Log</p><h2>What the agent did</h2></div></div>
        <ActivityList items={agentDid} empty="The agent hasn’t done anything on your account yet. Authorize it, then send USDG to your receive account." />
      </article>
    </div>
  </div>;
}
