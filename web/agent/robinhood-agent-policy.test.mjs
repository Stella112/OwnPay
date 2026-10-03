import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIncoming } from './robinhood-agent-policy.mjs';

const base = {
  balance: 40n,
  maxPayment: 500n,
  dailyLimit: 500n,
  spentDay: 2n,
  spentToday: 100n,
  today: 2n,
};

test('processes the complete pending balance when it fits both saved limits', () => {
  assert.deepEqual(decideIncoming(base), { action: 'process', amount: 40n });
});

test('defers the entire balance instead of partially processing above the per-payment cap', () => {
  assert.deepEqual(decideIncoming({ ...base, balance: 501n }), { action: 'defer', reason: 'per-payment-limit' });
});

test('defers rather than partially processing above the remaining daily cap', () => {
  assert.deepEqual(decideIncoming({ ...base, balance: 401n }), { action: 'defer', reason: 'daily-limit' });
});

test('uses the complete daily limit after the onchain spending day rolls over', () => {
  assert.deepEqual(decideIncoming({ ...base, balance: 400n, today: 3n }), { action: 'process', amount: 400n });
});

test('ignores an empty receive balance', () => {
  assert.deepEqual(decideIncoming({ ...base, balance: 0n }), { action: 'ignore', reason: 'empty' });
});
