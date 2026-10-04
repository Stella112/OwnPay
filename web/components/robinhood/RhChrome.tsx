'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { OwnPayIcon } from '@/components/OwnPayIcon';
import { useRh } from './session';
import { short, styles } from './ui';

const NAV = [
  { href: '/robinhood', label: 'Home', icon: 'home' },
  { href: '/robinhood/pay', label: 'Pay', icon: 'send' },
  { href: '/robinhood/stocks', label: 'Stocks', icon: 'gift' },
  { href: '/robinhood/ownership', label: 'Ownership', icon: 'wallet' },
  { href: '/robinhood/rules', label: 'Rules', icon: 'spark' },
  { href: '/robinhood/compliance', label: 'Compliance', icon: 'shield' },
  { href: '/robinhood/agent', label: 'Agent', icon: 'tip' },
  { href: '/robinhood/activity', label: 'Activity', icon: 'activity' },
] as const;

export function RhSidebar() {
  const path = usePathname();
  return (
    <aside className="dashboard-sidebar" aria-label="Robinhood testnet navigation">
      <div className="dashboard-sidebar-label">Robinhood testnet</div>
      {NAV.map((n) => { const active = n.href === '/robinhood' ? path === n.href : path.startsWith(n.href); return (
        <Link key={n.href} className={`dashboard-nav-item${active ? ' dashboard-nav-active' : ''}`} href={n.href} aria-current={active ? 'page' : undefined}><OwnPayIcon name={n.icon} size={18} /> {n.label}</Link>); })}
      <div className="dashboard-sidebar-bottom">
        <a className="dashboard-nav-item dashboard-nav-muted" href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer"><OwnPayIcon name="arrow" size={18} /> Testnet faucet</a>
      </div>
    </aside>
  );
}

/** Account bar shown on every Robinhood page: identity, smart account, testnet notice. */
export function RhAccountBar() {
  const { owner, signerOwner, smartAccount, kernelStatus, setSmartAccount, auth, busy, refresh } = useRh();
  const mode = !signerOwner ? 'Sign in to use OwnPay on Robinhood testnet'
    : smartAccount ? 'Smart account · gas sponsored'
    : kernelStatus === 'starting' ? 'Preparing your smart account…'
    : 'Signer wallet · you pay testnet gas';
  return (
    <div className={styles.topActions} style={{ flexWrap: 'wrap', gap: 12 }}>
      <div className="dashboard-identity">
        <span className="identity-avatar"><OwnPayIcon name="wallet" size={21} /></span>
        <span><strong>{owner ? short(owner) : 'Not signed in'}</strong><small>{mode}</small></span>
        {owner && <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(owner)}>Copy address</button>}
        {signerOwner && process.env.NEXT_PUBLIC_ROBINHOOD_ZERODEV_RPC && (smartAccount
          ? <button className="btn btn-ghost" onClick={() => setSmartAccount(false)}>Use signer wallet</button>
          : kernelStatus !== 'starting' && <button className="btn btn-ghost" onClick={() => setSmartAccount(true)}>Use smart account</button>)}
        {auth}
      </div>
      <span className={styles.testnetPill}><span className={styles.liveDot} /> Testnet only · no monetary value</span>
      <button className="btn" disabled={busy} onClick={() => void refresh()}><OwnPayIcon name="activity" size={16} /> Refresh</button>
    </div>
  );
}
