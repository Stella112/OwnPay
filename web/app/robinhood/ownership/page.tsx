'use client';
import { useQuery } from '@tanstack/react-query';
import { encodeAbiParameters, encodeFunctionData, formatUnits } from 'viem';
import { rhVestingAbi } from '@/lib/robinhood-vesting';
import { RH_STOCKS, rhStockTokenAbi } from '@/lib/robinhood-stocks';
import { rhChain, useRh } from '@/components/robinhood/session';
import { ActivityList, RhPageHeader, shares, styles, usdg } from '@/components/robinhood/ui';

export default function OwnershipPage() {
  const { owner, snapshot, busy, run, signed, sendCalls, history } = useRh();
  const disabled = busy || !owner || !snapshot;
  const holdings = useQuery({
    queryKey: ['rh-holdings', owner],
    enabled: !!owner,
    refetchInterval: 20_000,
    queryFn: () => Promise.all(RH_STOCKS.map(async (t) => {
      const [bal, mult] = await Promise.all([
        rhChain.readContract({ address: t.address, abi: rhStockTokenAbi, functionName: 'balanceOf', args: [owner!] }),
        rhChain.readContract({ address: t.address, abi: rhStockTokenAbi, functionName: 'uiMultiplier' }),
      ]);
      return { ...t, shares: formatUnits((bal * mult) / 10n ** 18n, 18) };
    })),
  });
  const ownershipEvents = history.filter((i) => ['income_split', 'payment_received', 'withdrawal', 'stock_grant_received', 'stock_claimed', 'stock_tip_received'].includes(i.kind));
  const withdraw = (ownership: boolean, raw?: string) => run(() => signed(3, encodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }], [ownership, BigInt(raw || '0')])));
  const claim = (id: string) => run(() => sendCalls([{ to: snapshot!.vesting!, data: encodeFunctionData({ abi: rhVestingAbi, functionName: 'claim', args: [BigInt(id)] }) }]));

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Ownership" title="What you own" subtitle="Your ownership reserve, savings, stock tokens and vesting grants, read live from the chain." />
    <div className={styles.metrics}>
      <article className={styles.metric}><span>Ownership reserve</span><strong>{usdg(snapshot?.reserve)}</strong><small>USDG your rule set aside to own</small></article>
      <article className={styles.metric}><span>Savings</span><strong>{usdg(snapshot?.savings)}</strong><small>USDG escrowed for you</small></article>
      <article className={styles.metric}><span>Stock tokens</span><strong>{holdings.data ? holdings.data.filter((h) => Number(h.shares) > 0).length : '—'}</strong><small>Different testnet stocks held</small></article>
      <article className={styles.metric}><span>Vesting grants</span><strong>{snapshot?.grantCount ?? '—'}</strong><small>From your ownership rule</small></article>
    </div>
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Stock tokens</p><h2>Holdings</h2></div><span className="pill pill-muted">Testnet · no value</span></div>
        <div className={styles.activityList}>{(holdings.data ?? RH_STOCKS.map((t) => ({ ...t, shares: '' }))).map((h) => <article className={styles.activityItem} key={h.symbol}><div className={styles.activityTitle}><strong>{h.symbol} · {h.name}</strong><span>{h.shares === '' ? '…' : `${Number(h.shares).toLocaleString(undefined, { maximumFractionDigits: 6 })} shares`}</span></div></article>)}</div>
        <hr className="divide" />
        <h3>Withdraw</h3>
        <p className={styles.fieldHint}>Savings and the ownership reserve are always yours to withdraw. No lockup, no yield claimed.</p>
        <div className={styles.buttonRow}>
          <button className="btn" disabled={disabled || !Number(snapshot?.savings)} onClick={() => void withdraw(false, snapshot?.savings)}>Withdraw savings</button>
          <button className="btn" disabled={disabled || !Number(snapshot?.reserve)} onClick={() => void withdraw(true, snapshot?.reserve)}>Withdraw ownership reserve</button>
        </div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Vesting</p><h2>Grants from your rule</h2></div></div>
        {!snapshot?.grants?.length ? <div className={styles.emptyState}>No vesting grants yet. They appear when your rule buys an asset with a vesting schedule.</div>
          : <div className={styles.activityList}>{snapshot.grants.map((g) => <article className={styles.activityItem} key={g.id}><div className={styles.activityTitle}><strong>Grant #{g.id}</strong><span>{shares(g.claimable)} claimable</span></div><p>{shares(g.total)} total · {shares(g.released)} claimed</p><button className="btn" disabled={disabled || !Number(g.claimable)} onClick={() => void claim(g.id)}>Claim</button></article>)}</div>}
        <hr className="divide" />
        <h3>Ownership activity</h3>
        <ActivityList items={ownershipEvents.slice(0, 6)} empty="No ownership activity yet." />
      </article>
    </div>
  </div>;
}
