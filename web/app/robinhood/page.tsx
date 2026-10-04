'use client';
import Link from 'next/link';
import { encodeFunctionData, zeroAddress } from 'viem';
import { ownRulesAbi } from '@/lib/robinhood';
import { useRh } from '@/components/robinhood/session';
import { ActivityList, RhPageHeader, styles, usdg } from '@/components/robinhood/ui';

export default function RobinhoodHome() {
  const { owner, snapshot, history, historyLoading, busy, run, signed, sendCalls, commitment, checkedAt } = useRh();
  const accountExists = !!snapshot?.account && snapshot.account !== zeroAddress;
  const service = snapshot?.agentService;
  const agentOn = service?.state === 'online' && service.mode === 'execute';
  const delegated = !!snapshot?.delegation && snapshot.delegation[0] !== zeroAddress && Number(snapshot.delegation[1]) * 1000 > checkedAt;
  const disabled = busy || !owner || !snapshot;
  const cards: [string, string, string][] = [
    ['Spendable USDG', usdg(snapshot?.balance), 'In your wallet'],
    ['Savings', usdg(snapshot?.savings), 'Escrowed, withdraw anytime'],
    ['Ownership reserve', usdg(snapshot?.reserve), 'Set aside to own'],
    ['Agent', agentOn ? (delegated ? 'Working for you' : 'Online · not authorized') : 'Offline', agentOn && delegated ? 'Splits income automatically' : 'See Agent page'],
  ];

  async function processPending() {
    if (!owner || !snapshot) throw new Error('Sign in first.');
    await sendCalls([{ to: snapshot.router, data: encodeFunctionData({ abi: ownRulesAbi, functionName: 'processIncoming', args: [owner, BigInt(snapshot.incoming || '0'), await commitment('')] }) }]);
  }

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Robinhood Chain · Testnet" title="Money arrives. OwnPay knows what to do" subtitle="Your rule splits every incoming payment into spendable cash, savings and ownership, on chain." />
    <div className={styles.metrics} aria-label="Balances">{cards.map(([t, v, c]) => <article className={styles.metric} key={t}><span>{t}</span><strong>{v}</strong><small>{c}</small></article>)}</div>

    <div className={styles.panelGrid}>
      <article className={`${styles.panel} ${styles.receivePanel}`}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Receive</p><h2>Your USDG account</h2></div><span className="pill pill-muted">{accountExists ? 'Ready' : 'Not created'}</span></div>
        <p className={styles.softText}>Money sent here is split by your rule. With the agent authorized, it happens automatically within seconds.</p>
        <div className={styles.addressBox}><span>{accountExists ? snapshot!.account : 'Create your receive account to start'}</span>{accountExists && <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(snapshot!.account!)}>Copy</button>}</div>
        <div className={styles.pendingLine}><span>Waiting to be split</span><strong>{usdg(snapshot?.incoming)} USDG</strong></div>
        <div className={styles.buttonRow}>
          {!accountExists && <button className="btn btn-primary" disabled={disabled} onClick={() => void run(() => signed(0, '0x'))}>Create receive account</button>}
          <button className="btn" disabled={disabled || !accountExists || !snapshot?.rule?.[7] || !Number(snapshot?.incoming)} onClick={() => void run(processPending)}>Split it now</button>
        </div>
        {!snapshot?.rule?.[7] && accountExists && <p className={styles.fieldHint}>No rule yet. <Link href="/robinhood/rules">Set your split</Link> so incoming money knows where to go.</p>}
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Latest</p><h2>What just happened</h2></div><Link className="btn btn-ghost" href="/robinhood/activity">All activity</Link></div>
        {historyLoading ? <div className={styles.emptyState}>Reading your onchain history…</div>
          : <ActivityList items={history.slice(0, 6)} empty={owner ? 'Nothing yet. Payments, splits and agent actions will appear here.' : 'Sign in to see your activity.'} />}
      </article>
    </div>
  </div>;
}
