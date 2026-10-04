'use client';
import { useState } from 'react';
import { encodeAbiParameters, parseUnits, type Address } from 'viem';
import { RH_STOCKS } from '@/lib/robinhood-stocks';
import { useRh } from '@/components/robinhood/session';
import { Field, RhPageHeader, styles, usdg } from '@/components/robinhood/ui';

export default function RulesPage() {
  const { owner, snapshot, busy, run, signed } = useRh();
  const rule = snapshot?.rule;
  const [saved, setSaved] = useState(rule ? String(rule[0] / 100) : '10');
  const [owned, setOwned] = useState(rule ? String(rule[1] / 100) : '20');
  const [max, setMax] = useState(rule ? usdg(rule[2]).replace(/,/g, '') : '100');
  const [daily, setDaily] = useState(rule ? usdg(rule[3]).replace(/,/g, '') : '500');
  // portfolio weights (% of the ownership share) keyed by asset address
  const initial: Record<string, string> = {};
  for (const p of snapshot?.portfolio ?? []) initial[p.asset.toLowerCase()] = String(p.weightBps / 100);
  const [weights, setWeights] = useState<Record<string, string>>(initial);
  const [vestingDays, setVestingDays] = useState(String(Number(snapshot?.vestingSeconds || 0) / 86400));
  const disabled = busy || !owner || !snapshot;
  const spend = 100 - Number(saved || 0) - Number(owned || 0);
  const picked = RH_STOCKS.filter((t) => Number(weights[t.address.toLowerCase()] || 0) > 0);
  const total = picked.reduce((a, t) => a + Number(weights[t.address.toLowerCase()]), 0);
  const shareOf = (a: string) => total > 0 ? Number(weights[a.toLowerCase()] || 0) / total * 100 : 0;
  const priceOf = (a: Address) => snapshot?.desk?.prices.find((p) => p.asset.toLowerCase() === a.toLowerCase());

  function ruleData() {
    const s = Math.round(Number(saved) * 100), o = Math.round(Number(owned) * 100);
    if (!Number.isFinite(s) || !Number.isFinite(o) || s < 0 || o < 0 || s + o > 10000) throw new Error('Savings and ownership must total no more than 100%.');
    let maxRaw: bigint, dailyRaw: bigint;
    try { maxRaw = parseUnits(max.trim(), 6); dailyRaw = parseUnits(daily.trim(), 6); } catch { throw new Error('Enter valid USDG amounts for the limits.'); }
    if (maxRaw <= 0n) throw new Error('Max per payment must be greater than zero.');
    if (dailyRaw < maxRaw) throw new Error('Daily limit must be at least the max per payment (one payment has to fit in a day).');
    const assets = picked.map((t) => t.address as Address);
    // Weights are relative (1:1, 2:1, 50:50…); normalize to exactly 100% in basis points.
    const bps = picked.map((t) => Math.floor(Number(weights[t.address.toLowerCase()]) / total * 10000));
    if (bps.length) bps[bps.indexOf(Math.max(...bps))] += 10000 - bps.reduce((a, b) => a + b, 0);
    return encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address[]' }, { type: 'uint16[]' }, { type: 'bool' }],
      [s, o, maxRaw, dailyRaw, assets, bps, true]);
  }

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Rules" title="Decide what money does" subtitle="Your OwnRule splits every incoming payment, and your ownership share buys the stocks you choose. Enforced by the contract, not this website." />
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Your rule</p><h2>The split</h2></div><span className="pill pill-muted">{rule?.[5] ? `Active · v${rule[4]}` : 'Not set'}</span></div>
        <div className={styles.fieldGrid}>
          <Field label="Savings %" value={saved} onChange={setSaved} mono />
          <Field label="Ownership %" value={owned} onChange={setOwned} mono />
          <Field label="Max per payment · USDG" value={max} onChange={setMax} mono />
          <Field label="Daily limit · USDG" value={daily} onChange={setDaily} mono />
        </div>
        <div className={styles.splitBar}><span>Spendable <strong>{Number.isFinite(spend) ? spend : '—'}%</strong></span><span>Savings <strong>{saved}%</strong></span><span>Ownership <strong>{owned}%</strong></span></div>
        <p className={styles.inlineWarning}>Saving resets agent access. Re-authorize the agent afterwards if you want automation.</p>
        <button className="btn btn-primary" disabled={disabled} onClick={() => void run(() => signed(1, ruleData()))}>Save rule</button>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Ownership portfolio</p><h2>What your {owned || 0}% buys</h2></div><span className="pill pill-muted">{picked.length ? `${picked.length} stock${picked.length > 1 ? 's' : ''}` : 'Keep as USDG'}</span></div>
        <p className={styles.softText}>Give each stock you want a weight, e.g. 1 and 1 for half each, or 2 and 1. Up to 5 stocks. While the market is open it buys instantly at the market price; when it’s closed, the money is set aside and bought at the next session.</p>
        <div className={styles.activityList}>{RH_STOCKS.map((t) => { const p = priceOf(t.address); return (
          <article className={styles.activityItem} key={t.symbol}>
            <div className={styles.activityTitle}>
              <strong>{t.symbol} · {t.name}</strong>
              <span className={`pill ${p?.fresh ? 'pill-accent' : 'pill-muted'}`}>{!p || p.usdPerShare === '0' ? 'No price yet' : `$${(Number(p.usdPerShare) / 1e8).toFixed(2)} · ${p.fresh ? 'market open' : 'market closed'}`}</span>
            </div>
            <label className={styles.field}>Weight{shareOf(t.address) > 0 ? ` → ${shareOf(t.address).toFixed(1)}% of your ownership money` : ''}<input className="input tnum" inputMode="decimal" placeholder="0" value={weights[t.address.toLowerCase()] ?? ''} onChange={(e) => setWeights({ ...weights, [t.address.toLowerCase()]: e.target.value })} /></label>
          </article>); })}</div>
        <p className={styles.fieldHint}>Leave all at 0 to keep your ownership share as withdrawable USDG. Prices: public market data relayed on chain; testnet stock tokens have no monetary value.</p>
        <hr className="divide" />
        <h3>Vest what you buy</h3>
        <Field label="Vesting days (0 = immediate, max 365)" value={vestingDays} onChange={setVestingDays} mono hint={`Current: ${Number(snapshot?.vestingSeconds || 0) / 86400} days. Changing it also resets agent access.`} />
        <button className="btn" disabled={disabled || !rule?.[4]} onClick={() => void run(() => signed(4, encodeAbiParameters([{ type: 'uint64' }], [BigInt(Math.round(Number(vestingDays) * 86400))])))}>Save vesting</button>
      </article>
    </div>
  </div>;
}
