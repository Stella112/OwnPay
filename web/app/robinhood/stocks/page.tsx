'use client';
import { RobinhoodStocks } from '@/components/RobinhoodStocks';
import { useRh } from '@/components/robinhood/session';
import { RhPageHeader, styles } from '@/components/robinhood/ui';

export default function StocksPage() {
  const { owner, snapshot, busy, run, sendCalls } = useRh();
  return <div className={styles.workbench}>
    <RhPageHeader eyebrow="Stocks" title="Pay, gift or tip in stock" subtitle="Grant testnet stock tokens that vest over time, gift them for a date, or tip instantly with a note." />
    <RobinhoodStocks owner={owner} disabled={busy || !owner || !snapshot} run={run} sendCalls={sendCalls} />
  </div>;
}
