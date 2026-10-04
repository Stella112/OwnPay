'use client';
import { useState } from 'react';
import { encodeAbiParameters, parseUnits, zeroAddress } from 'viem';
import { useRh } from '@/components/robinhood/session';
import { Field, RhPageHeader, styles, usdg } from '@/components/robinhood/ui';

export default function RulesPage() {
  const { owner, snapshot, busy, run, signed } = useRh();
  const rule = snapshot?.rule;
  const [saved, setSaved] = useState(rule ? String(rule[0] / 100) : '10');
  const [owned, setOwned] = useState(rule ? String(rule[1] / 100) : '20');
  const [max, setMax] = useState(rule ? usdg(rule[2]).replace(/,/g, '') : '100');
  const [daily, setDaily] = useState(rule ? usdg(rule[3]).replace(/,/g, '') : '500');
  const [demo, setDemo] = useState(!!rule && rule[4] !== zeroAddress);
  const [vestingDays, setVestingDays] = useState(String(Number(snapshot?.vestingSeconds || 0) / 86400));
  const disabled = busy || !owner || !snapshot;
  const spend = 100 - Number(saved || 0) - Number(owned || 0);

  function ruleData() {
    const s = Math.round(Number(saved) * 100), o = Math.round(Number(owned) * 100);
    if (!Number.isFinite(s) || !Number.isFinite(o) || s < 0 || o < 0 || s + o > 10000) throw new Error('Savings and ownership must total no more than 100%.');
    if (demo && !snapshot?.demoAdapter) throw new Error('The demo adapter is not deployed.');
    let maxRaw: bigint, dailyRaw: bigint;
    try { maxRaw = parseUnits(max.trim(), 6); dailyRaw = parseUnits(daily.trim(), 6); } catch { throw new Error('Enter valid USDG amounts for the limits.'); }
    if (maxRaw <= 0n) throw new Error('Max per payment must be greater than zero.');
    if (dailyRaw < maxRaw) throw new Error('Daily limit must be at least the max per payment (one payment has to fit in a day).');
    return encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'uint128' }, { type: 'bool' }],
      [s, o, maxRaw, dailyRaw, demo ? snapshot!.demoAdapter! : zeroAddress, demo ? 10n ** 18n : 0n, true]);
  }

  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Rules" title="Decide what money does" subtitle="Your OwnRule splits every incoming payment. It is enforced by the contract, not by this website." />
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Your rule</p><h2>The split</h2></div><span className="pill pill-muted">{rule?.[7] ? `Active · v${rule[6]}` : 'Not set'}</span></div>
        <div className={styles.fieldGrid}>
          <Field label="Savings %" value={saved} onChange={setSaved} mono />
          <Field label="Ownership %" value={owned} onChange={setOwned} mono />
          <Field label="Max per payment · USDG" value={max} onChange={setMax} mono />
          <Field label="Daily limit · USDG" value={daily} onChange={setDaily} mono />
        </div>
        <div className={styles.splitBar}><span>Spendable <strong>{Number.isFinite(spend) ? spend : '—'}%</strong></span><span>Savings <strong>{saved}%</strong></span><span>Ownership <strong>{owned}%</strong></span></div>
        <label className={styles.checkboxRow}><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /><span><strong>Buy DEMO-OWN with the ownership share</strong><small>No-value demo asset. Leave off to keep ownership as a withdrawable USDG reserve.</small></span></label>
        <p className={styles.inlineWarning}>Saving a new rule resets agent access. Re-authorize the agent afterwards if you want automation.</p>
        <button className="btn btn-primary" disabled={disabled} onClick={() => void run(() => signed(1, ruleData()))}>Save rule</button>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Ownership vesting</p><h2>Vest what you buy</h2></div></div>
        <p className={styles.softText}>When your rule buys an asset, it can vest it to you over time instead of paying it out at once. Applies to bought assets, not to the USDG reserve.</p>
        <Field label="Vesting days (0 = immediate, max 365)" value={vestingDays} onChange={setVestingDays} mono />
        <p className={styles.fieldHint}>Current: {Number(snapshot?.vestingSeconds || 0) / 86400} days. Changing it also resets agent access.</p>
        <button className="btn" disabled={disabled || !rule?.[6]} onClick={() => void run(() => signed(4, encodeAbiParameters([{ type: 'uint64' }], [BigInt(Math.round(Number(vestingDays) * 86400))])))}>Save vesting</button>
      </article>
    </div>
  </div>;
}
