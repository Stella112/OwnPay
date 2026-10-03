'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPublicClient, encodeFunctionData, formatUnits, http, isAddress, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { robinhoodTestnet } from '@/lib/robinhood';
import { decodeMemo, encodeMemo, isEmptyMemo, isMemoValid, memoByteLength, MEMO_MAX_BYTES } from '@/lib/memo';
import { RH_STOCKS, RH_STOCK_VESTING, RH_STOCK_VESTING_FROM_BLOCK, rawToShares, rhStockByAddress, rhStockBySymbol, rhStockTokenAbi, rhStockVestingAbi, sharesToRaw } from '@/lib/robinhood-stocks';
import styles from './RobinhoodWorkbench.module.css';

const chain = createPublicClient({ chain: robinhoodTestnet, transport: http() });
type Call = { to: Address; data: Hex };
type Mode = 'pay' | 'gift' | 'tip';

// Demo schedules are deliberately short and labelled; real-world presets alongside.
const PAY_PRESETS = [
  { key: 'demo', label: 'Demo · 30s cliff, 2 min vest', cliff: 30, duration: 120 },
  { key: 'std', label: '3 month cliff, 1 year vest', cliff: 90 * 86400, duration: 365 * 86400 },
];
const GIFT_PRESETS = [
  { key: 'demo', label: 'Demo · unlocks in 1 minute', unlock: 60 },
  { key: 'm1', label: 'Unlocks in 30 days', unlock: 30 * 86400 },
];

type Grant = {
  id: bigint; token: Address; from: Address; to: Address; total: bigint; released: bigint;
  start: number; cliff: number; duration: number; revocable: boolean; revoked: boolean; memo: Hex;
  vested: bigint; releasable: bigint;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (raw: bigint, mult: bigint | undefined, decimals: number) =>
  mult === undefined ? '—' : Number(formatUnits(rawToShares(raw, mult), decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });

async function loadStocks(owner: Address) {
  const tokens = await Promise.all(RH_STOCKS.map(async (t) => {
    const [mult, decimals, balance] = await Promise.all([
      chain.readContract({ address: t.address, abi: rhStockTokenAbi, functionName: 'uiMultiplier' }),
      chain.readContract({ address: t.address, abi: rhStockTokenAbi, functionName: 'decimals' }),
      chain.readContract({ address: t.address, abi: rhStockTokenAbi, functionName: 'balanceOf', args: [owner] }),
    ]);
    return { ...t, mult, decimals: Number(decimals), balance };
  }));
  const logs = await chain.getContractEvents({ address: RH_STOCK_VESTING, abi: rhStockVestingAbi, eventName: 'GrantCreated', fromBlock: RH_STOCK_VESTING_FROM_BLOCK, toBlock: 'latest' });
  const mine = logs.filter((l) => l.args.to?.toLowerCase() === owner.toLowerCase() || l.args.from?.toLowerCase() === owner.toLowerCase()).slice(-30);
  const grants: Grant[] = await Promise.all(mine.map(async (l) => {
    const id = l.args.id!;
    const [g, vested, releasable] = await Promise.all([
      chain.readContract({ address: RH_STOCK_VESTING, abi: rhStockVestingAbi, functionName: 'grants', args: [id] }),
      chain.readContract({ address: RH_STOCK_VESTING, abi: rhStockVestingAbi, functionName: 'vestedRaw', args: [id] }),
      chain.readContract({ address: RH_STOCK_VESTING, abi: rhStockVestingAbi, functionName: 'releasableRaw', args: [id] }),
    ]);
    const [token, from, to, total, released, start, cliff, duration, revocable, revoked, memo] = g;
    return { id, token, from, to, total, released, start: Number(start), cliff: Number(cliff), duration: Number(duration), revocable, revoked, memo, vested, releasable };
  }));
  const now = Number((await chain.getBlock()).timestamp); // vesting is decided by block time
  return { tokens, grants: grants.reverse(), now };
}

export function RobinhoodStocks({ owner, disabled, run, sendCalls }: {
  owner?: Address;
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  sendCalls: (calls: Call[]) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('pay');
  const [symbol, setSymbol] = useState<string>('TSLA');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('0.1');
  const [memo, setMemo] = useState('');
  const [payPreset, setPayPreset] = useState('demo');
  const [giftPreset, setGiftPreset] = useState('demo');

  const data = useQuery({
    queryKey: ['rh-stocks', owner],
    enabled: !!owner,
    queryFn: () => loadStocks(owner!),
    refetchInterval: 10_000, // chain-authoritative vesting progress
  });
  const tokenInfo = (addr: string) => data.data?.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());
  const selected = data.data?.tokens.find((t) => t.symbol === symbol);
  const memoOk = isMemoValid(memo);

  async function submit() {
    if (!owner || !selected) throw new Error('Sign in and wait for balances to load.');
    if (!isAddress(to) || to === zeroAddress) throw new Error('Enter a valid recipient address.');
    if (to.toLowerCase() === owner.toLowerCase()) throw new Error('Choose a recipient other than yourself.');
    if (!memoOk) throw new Error('Memo is too long. Shorten it before continuing.');
    let shares: bigint;
    try { shares = parseUnits(amount.trim(), selected.decimals); } catch { throw new Error('Enter a valid amount.'); }
    if (shares <= 0n) throw new Error('Amount must be greater than zero.');
    const raw = sharesToRaw(shares, selected.mult); // RAW units move onchain
    if (raw > selected.balance) throw new Error(`Not enough ${selected.symbol}. You hold ${fmt(selected.balance, selected.mult, selected.decimals)}.`);

    const calls: Call[] = [];
    const allowance = await chain.readContract({ address: selected.address, abi: rhStockTokenAbi, functionName: 'allowance', args: [owner, RH_STOCK_VESTING] });
    if (allowance < raw) calls.push({ to: selected.address, data: encodeFunctionData({ abi: rhStockTokenAbi, functionName: 'approve', args: [RH_STOCK_VESTING, raw] }) });
    const memoHex = encodeMemo(memo);
    if (mode === 'tip') {
      calls.push({ to: RH_STOCK_VESTING, data: encodeFunctionData({ abi: rhStockVestingAbi, functionName: 'tipWithMemo', args: [selected.address, to, raw, memoHex] }) });
    } else {
      // Chain time, not browser time, anchors the schedule.
      const now = Number((await chain.getBlock()).timestamp);
      const p = PAY_PRESETS.find((x) => x.key === payPreset)!;
      const g = GIFT_PRESETS.find((x) => x.key === giftPreset)!;
      const [cliff, duration] = mode === 'pay' ? [now + p.cliff, p.duration] : [now + g.unlock, g.unlock]; // gift: cliff == end
      calls.push({ to: RH_STOCK_VESTING, data: encodeFunctionData({ abi: rhStockVestingAbi, functionName: 'createGrant', args: [selected.address, to, raw, BigInt(now), BigInt(cliff), BigInt(duration), mode === 'pay', memoHex] }) });
    }
    await sendCalls(calls);
    await data.refetch();
  }

  const act = (fn: 'release' | 'revoke', id: bigint) => run(async () => {
    await sendCalls([{ to: RH_STOCK_VESTING, data: encodeFunctionData({ abi: rhStockVestingAbi, functionName: fn, args: [id] }) }]);
    await data.refetch();
  });

  const incoming = (data.data?.grants ?? []).filter((g) => owner && g.to.toLowerCase() === owner.toLowerCase());
  const outgoing = (data.data?.grants ?? []).filter((g) => owner && g.from.toLowerCase() === owner.toLowerCase());
  const nowSec = data.data?.now ?? 0;

  return (
    <div className={styles.panelGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Stock tokens</p><h2>Pay, gift or tip in stock</h2></div><span className="pill pill-muted">Testnet · no value</span></div>
        <div className="choice-grid" role="radiogroup" aria-label="Mode">
          {(['pay', 'gift', 'tip'] as const).map((m) => (
            <button key={m} type="button" className="choice" data-selected={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              <div className="k">{m === 'pay' ? 'Pay' : m === 'gift' ? 'Gift' : 'Tip'}</div>
              <div className="v">{m === 'pay' ? 'Vests; you can revoke unvested' : m === 'gift' ? 'Unlocks once; irrevocable' : 'Instant, with a memo'}</div>
            </button>
          ))}
        </div>
        <div className={styles.formStack}>
          <label className={styles.field}>Stock token
            <select className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {RH_STOCKS.map((t) => { const i = tokenInfo(t.address); return <option key={t.symbol} value={t.symbol}>{t.symbol} · {t.name}{i ? ` · you hold ${fmt(i.balance, i.mult, i.decimals)}` : ''}</option>; })}
            </select>
          </label>
          <label className={styles.field}>Recipient wallet<input className="input" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></label>
          <label className={styles.field}>Amount · {symbol} shares<input className="input tnum" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          {mode === 'pay' && <label className={styles.field}>Vesting schedule<select className="input" value={payPreset} onChange={(e) => setPayPreset(e.target.value)}>{PAY_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>}
          {mode === 'gift' && <label className={styles.field}>Unlock<select className="input" value={giftPreset} onChange={(e) => setGiftPreset(e.target.value)}>{GIFT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>}
          <label className={styles.field}>Memo (onchain, public)<input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={mode === 'gift' ? 'Happy birthday' : mode === 'tip' ? 'thanks!' : '2026 contributor'} />
            <span className={styles.fieldHint}>{memoByteLength(memo)}/{MEMO_MAX_BYTES} bytes{!memoOk && ' — too long'}</span></label>
        </div>
        <div className={styles.notice}>Faucet-issued Robinhood Chain testnet stock tokens. Not registry-listed, no monetary value. Amounts move in raw token units; shares are shown after applying each token&apos;s <code>uiMultiplier</code>.</div>
        <button className="btn btn-primary" disabled={disabled || !selected || !memoOk} onClick={() => void run(submit)}>
          {mode === 'pay' ? 'Create vesting grant' : mode === 'gift' ? 'Send stock gift' : 'Send stock tip'}
        </button>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className="eyebrow">Onchain grants</p><h2>Your stock grants</h2></div><span className="pill pill-muted">{data.isFetching ? 'Refreshing…' : `${incoming.length} in · ${outgoing.length} out`}</span></div>
        {!owner && <p className="muted">Sign in to see grants addressed to you.</p>}
        {data.isError && <p className="field-error">Could not read grants from the testnet. Retry with Refresh.</p>}
        {[...incoming.map((g) => ({ g, dir: 'in' as const })), ...outgoing.filter((g) => !incoming.includes(g)).map((g) => ({ g, dir: 'out' as const }))].map(({ g, dir }) => {
          const t = tokenInfo(g.token); const sym = rhStockByAddress(g.token)?.symbol ?? short(g.token);
          const d = t?.decimals ?? 18; const pct = g.total > 0n ? Number((g.vested * 1000n) / g.total) / 10 : 0;
          const note = isEmptyMemo(g.memo) ? '' : decodeMemo(g.memo);
          const state = g.revoked ? 'Revoked' : !g.revocable ? (nowSec < g.cliff ? `Gift · unlocks ${new Date(g.cliff * 1000).toLocaleString()}` : 'Gift · unlocked') : nowSec < g.cliff ? `Cliff ${new Date(g.cliff * 1000).toLocaleTimeString()}` : pct >= 100 ? 'Fully vested' : `${pct}% vested`;
          return (
            <div key={String(g.id)} className={styles.notice} style={{ display: 'grid', gap: 6 }}>
              <div className="spread"><strong>#{String(g.id)} · {fmt(g.total, t?.mult, d)} {sym}</strong><span className="pill pill-muted">{dir === 'in' ? `from ${short(g.from)}` : `to ${short(g.to)}`}</span></div>
              <div className="progress" aria-label={`${pct}% vested`}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
              <div className="spread muted" style={{ fontSize: 13 }}><span>{state}</span><span>claimable {fmt(g.releasable, t?.mult, d)} · claimed {fmt(g.released, t?.mult, d)}</span></div>
              {note && <div className="muted" style={{ fontSize: 13 }}>“{note}”</div>}
              <div className="row">
                {dir === 'in' && g.releasable > 0n && <button className="btn btn-primary" disabled={disabled} onClick={() => void act('release', g.id)}>Claim {fmt(g.releasable, t?.mult, d)} {sym}</button>}
                {dir === 'out' && g.revocable && !g.revoked && g.vested < g.total && <button className="btn btn-danger" disabled={disabled} onClick={() => void act('revoke', g.id)}>Revoke unvested</button>}
              </div>
            </div>
          );
        })}
        {owner && data.isSuccess && incoming.length + outgoing.length === 0 && <p className="muted">No stock grants yet. Create one on the left.</p>}
      </article>
    </div>
  );
}
