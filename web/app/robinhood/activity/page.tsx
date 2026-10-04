'use client';
import { useState } from 'react';
import { useRh } from '@/components/robinhood/session';
import { ActivityList, RhPageHeader, styles } from '@/components/robinhood/ui';

const FILTERS = {
  all: { label: 'All', kinds: null },
  agent: { label: 'Agent', kinds: ['income_split', 'agent_changed'] },
  payments: { label: 'Payments', kinds: ['payment_sent', 'payment_received', 'income_split', 'withdrawal'] },
  stocks: { label: 'Stocks', kinds: ['stock_grant_received', 'stock_grant_sent', 'stock_claimed', 'stock_revoked', 'stock_tip_received', 'stock_tip_sent'] },
  settings: { label: 'Settings', kinds: ['rule_saved', 'policy_saved', 'sender_status', 'account_created', 'agent_changed'] },
} as const;

export default function ActivityPage() {
  const { owner, history, historyLoading, historyError } = useRh();
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const kinds = FILTERS[filter].kinds as readonly string[] | null;
  const items = history.filter((i) => !kinds || kinds.includes(i.kind) && (filter !== 'agent' || i.kind !== 'income_split' || i.actor === 'agent'));
  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Activity" title="Everything, on chain" subtitle="Every payment, split, agent action, stock grant and settings change for your account since deployment." />
    <div className={styles.tabList} role="tablist">{(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => <button key={k} role="tab" aria-selected={filter === k} className={`${styles.tab}${filter === k ? ` ${styles.tabActive}` : ''}`} onClick={() => setFilter(k)}>{FILTERS[k].label}</button>)}</div>
    <article className={styles.panel}>
      {historyError && <p className={styles.inlineWarning}>{historyError}</p>}
      {historyLoading ? <div className={styles.emptyState}>Reading your onchain history…</div>
        : <ActivityList items={items} empty={owner ? 'Nothing here yet.' : 'Sign in to see your activity.'} />}
    </article>
  </div>;
}
