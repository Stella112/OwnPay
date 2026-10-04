'use client';
import { formatUnits } from 'viem';
import { usePathname } from 'next/navigation';
import { OwnPayIcon } from '@/components/OwnPayIcon';
import { rhStockByAddress } from '@/lib/robinhood-stocks';
import { rhExplorer, useRh, type HistoryItem } from './session';
import styles from '../RobinhoodWorkbench.module.css';

export { styles };
export const usdg = (v?: string | null) => v == null ? '—' : trim(formatUnits(BigInt(v), 6));
export const shares = (v?: string | null) => v == null ? '—' : trim(formatUnits(BigInt(v), 18));
const trim = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : s; };
export const short = (a?: string | null) => !a ? '—' : `${a.slice(0, 6)}…${a.slice(-4)}`;
export const when = (t?: number) => t ? new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export function Field({ label, value, onChange, hint, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; mono?: boolean }) {
  return <label className={styles.field}>{label}<input className={`input${mono ? ' tnum' : ''}`} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />{hint && <span className={styles.fieldHint}>{hint}</span>}</label>;
}

/** Page heading + the session-wide notices (errors, confirmed tx). */
export function RhPageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const { error, errorPath, hash, clearNotice } = useRh();
  const path = usePathname();
  const showError = !!error && (!errorPath || errorPath === path); // never follow you to other pages
  return <>
    <div className="dashboard-welcome-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}<span className="welcome-mark">.</span></h1><p className="dashboard-subtitle">{subtitle}</p></div></div>
    {showError && <div className={styles.alert} role="alert">{error} <button className="btn btn-ghost" onClick={clearNotice}>Dismiss</button></div>}
    {hash && <div className={styles.success}><span>Transaction confirmed on Robinhood testnet.</span><a href={`${rhExplorer}/tx/${hash}`} target="_blank" rel="noreferrer">View on explorer <OwnPayIcon name="arrow" size={15} /></a></div>}
  </>;
}

/** Human description of one onchain history event. */
export function describe(i: HistoryItem): { title: string; detail: string; tone: 'agent' | 'in' | 'out' | 'setting' } {
  const d = i.data;
  const split = `${usdg(d.spendable as string)} spendable · ${usdg(d.saved as string)} savings · ${usdg(d.ownership as string)} ownership`;
  const sym = (t?: unknown) => rhStockByAddress(String(t ?? ''))?.symbol ?? 'stock';
  switch (i.kind) {
    case 'income_split': return i.actor === 'agent'
      ? { title: `Agent split ${usdg(d.amount as string)} USDG of incoming money`, detail: `${split} · rule v${d.ruleVersion}. Done automatically under your delegation.`, tone: 'agent' }
      : { title: `Incoming ${usdg(d.amount as string)} USDG processed`, detail: `${split} · rule v${d.ruleVersion}`, tone: 'in' };
    case 'payment_received': return { title: `Received ${usdg(d.amount as string)} USDG from ${short(d.payer as string)}`, detail: split, tone: 'in' };
    case 'payment_sent': return { title: `Paid ${usdg(d.amount as string)} USDG to ${short(d.owner as string)}`, detail: `Their rule split it: ${split}`, tone: 'out' };
    case 'ownership_bought': return { title: `Bought ${shares(d.rawOut as string)} ${sym(d.asset)}`, detail: `With ${usdg(d.usdgIn as string)} USDG of your ownership share, at the market price`, tone: 'in' };
    case 'ownership_queued': return { title: `${usdg(d.usdgAmount as string)} USDG queued to buy stock`, detail: 'Market closed: it will be bought at the next session', tone: 'setting' };
    case 'withdrawal': return { title: `Withdrew ${usdg(d.amount as string)} USDG from ${d.ownership ? 'ownership reserve' : 'savings'}`, detail: 'Back in your wallet', tone: 'out' };
    case 'rule_saved': return { title: `Saved rule v${d.version}`, detail: `${Number(d.savingsBps) / 100}% savings · ${Number(d.ownershipBps) / 100}% ownership${Array.isArray(d.assets) && d.assets.length ? ' → ' + (d.assets as unknown as string[]).map((a, k) => `${Number((d.weightsBps as unknown as string[])[k]) / 100}% ${sym(a)}`).join(', ') : ''} · agent access reset`, tone: 'setting' };
    case 'agent_changed': return d.agent === '0x0000000000000000000000000000000000000000'
      ? { title: 'Agent access revoked', detail: 'The agent can no longer process your income', tone: 'setting' }
      : { title: `Agent ${short(d.agent as string)} authorized`, detail: `Until ${when(Number(d.expires))} · for rule v${d.version}`, tone: 'setting' };
    case 'policy_saved': return { title: 'Payment policy updated', detail: [d.allowlistOnly ? 'allowlist-only' : 'open to everyone', d.requireMemo ? 'note required' : null, d.perSenderDailyCap !== '0' ? `per-sender cap ${usdg(d.perSenderDailyCap as string)} USDG/day` : null].filter(Boolean).join(' · '), tone: 'setting' };
    case 'sender_status': return { title: `${['Cleared', 'Allowed', 'Blocked'][Number(d.status)] ?? 'Changed'} sender ${short(d.sender as string)}`, detail: 'Your compliance list', tone: 'setting' };
    case 'account_created': return { title: 'Receive account created', detail: short(d.account as string), tone: 'setting' };
    case 'stock_grant_received': return { title: `Stock grant received: ${shares(d.total as string)} ${sym(d.token)}`, detail: `From ${short(d.from as string)} · ${d.revocable ? 'vesting' : 'gift'}`, tone: 'in' };
    case 'stock_grant_sent': return { title: `Stock grant sent: ${shares(d.total as string)} ${sym(d.token)}`, detail: `To ${short(d.to as string)} · ${d.revocable ? 'vesting, revocable' : 'gift, irrevocable'}`, tone: 'out' };
    case 'stock_claimed': return { title: `Claimed ${shares(d.rawAmount as string)} shares`, detail: `Grant #${d.id}`, tone: 'in' };
    case 'stock_revoked': return { title: `Revoked grant #${d.id}`, detail: `${shares(d.refundedRaw as string)} unvested shares returned to you`, tone: 'setting' };
    case 'stock_tip_received': return { title: `Tip received: ${shares(d.rawAmount as string)} ${sym(d.token)}`, detail: `From ${short(d.from as string)}`, tone: 'in' };
    case 'stock_tip_sent': return { title: `Tip sent: ${shares(d.rawAmount as string)} ${sym(d.token)}`, detail: `To ${short(d.to as string)}`, tone: 'out' };
    default: return { title: i.kind, detail: '', tone: 'setting' };
  }
}

const TONE: Record<string, string> = { agent: 'Agent', in: 'In', out: 'Out', setting: 'Setting' };
export function ActivityList({ items, empty }: { items: HistoryItem[]; empty: string }) {
  if (!items.length) return <div className={styles.emptyState}>{empty}</div>;
  return <div className={styles.activityList}>{items.map((i) => { const x = describe(i); return (
    <article className={styles.activityItem} key={i.tx + i.kind + i.block}>
      <div className={styles.activityTitle}><strong>{x.title}</strong><span className={`pill ${x.tone === 'agent' ? 'pill-accent' : 'pill-muted'}`}>{TONE[x.tone]}</span></div>
      <p>{x.detail}</p>
      <small><a href={`${rhExplorer}/tx/${i.tx}`} target="_blank" rel="noreferrer">{when(i.timestamp)} · view on explorer</a></small>
    </article>); })}</div>;
}
