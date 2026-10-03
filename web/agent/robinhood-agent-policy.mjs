// Keep automation all-or-nothing: never silently split one receive-account
// balance into smaller transactions just to squeeze under a user's limits.
export function decideIncoming({ balance, maxPayment, dailyLimit, spentDay, spentToday, today }) {
  const amount = BigInt(balance);
  const max = BigInt(maxPayment);
  const daily = BigInt(dailyLimit);
  const spent = BigInt(spentToday);

  if (amount <= 0n) return { action: 'ignore', reason: 'empty' };
  if (amount > max) return { action: 'defer', reason: 'per-payment-limit' };

  const remaining = BigInt(spentDay) === BigInt(today) ? daily - spent : daily;
  if (remaining <= 0n || amount > remaining) return { action: 'defer', reason: 'daily-limit' };

  return { action: 'process', amount };
}
