'use client';
import Link from 'next/link';
import { encodeAbiParameters, zeroAddress } from 'viem';
import { useRh } from '@/components/robinhood/session';
import { ActivityList, RhPageHeader, short, styles, when } from '@/components/robinhood/ui';

export default function AgentPage() {
  const { owner, snapshot, history, busy, run, signed, checkedAt } = useRh();
  const s = snapshot?.agentService;
  const d = snapshot?.delegation;
  const active = !!d && d[0] !== zeroAddress && Number(d[1]) * 1000 > checkedAt && d[2] === snapshot?.rule?.[6];
  const stale = !!d && d[0] !== zeroAddress && d[2] !== snapshot?.rule?.[6];
  const disabled = busy || !owner || !snapshot;
  const agentDid = history.filter((i) => (i.kind === 'income_split' && i.actor === 'agent') || i.kind === 'agent_changed');
  const splits = agentDid.filter((i) => i.kind === 'income_split');
  const status = s?.state === 'online' ? 'Online' : s?.state === 'degraded' ? 'Needs attention' : s?.state === 'stale' ? 'Heartbeat stale' : 'Not reporting';
  const delegate = (agent: `0x${string}`, expires: bigint) => run(() => signed(2, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [agent, expires])));

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
        <div className={styles.permissionBox}><span>Agent address</span><strong className={styles.mono}>{snapshot?.agent ? short(snapshot.agent) : 'Not configured'}</strong><small>Can only call processIncoming for your account, under rule v{snapshot?.rule?.[6] ?? '—'}, within your limits.</small></div>
        {!snapshot?.rule?.[7] && <p className={styles.inlineWarning}>Save a rule first. <Link href="/robinhood/rules">Go to Rules</Link></p>}
        {stale && <p className={styles.inlineWarning}>You changed your rule after authorizing, so the old permission no longer works. Authorize again.</p>}
        <div className={styles.buttonRow}>
          <button className="btn btn-primary" disabled={disabled || !snapshot?.agent || !snapshot?.rule?.[7]} onClick={() => void delegate(snapshot!.agent!, BigInt(Math.floor(Date.now() / 1000) + 86400))}>Authorize for 24 hours</button>
          <button className="btn" disabled={disabled || !d || d[0] === zeroAddress} onClick={() => void delegate(zeroAddress, 0n)}>Revoke</button>
        </div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Log</p><h2>What the agent did</h2></div></div>
        <ActivityList items={agentDid} empty="The agent hasn’t done anything on your account yet. Authorize it, then send USDG to your receive account." />
      </article>
    </div>
  </div>;
}
