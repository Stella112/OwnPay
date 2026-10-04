import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, toUsd8 } from './price-relay.mjs';

test('takes the latest non-null candle and its market timestamp', () => {
  const json = { chart: { result: [{ meta: { regularMarketPrice: 1, regularMarketTime: 5 }, timestamp: [100, 160, 220], indicators: { quote: [{ close: [370.1, 370.6, null] }] } }] } };
  assert.deepEqual(parseChart(json, 'TSLA'), { symbol: 'TSLA', price: 370.6, quoteTime: 160 });
});
test('falls back to regular-market meta when candles are empty', () => {
  const json = { chart: { result: [{ meta: { regularMarketPrice: 370.59, regularMarketTime: 1790971200 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } };
  assert.deepEqual(parseChart(json, 'TSLA'), { symbol: 'TSLA', price: 370.59, quoteTime: 1790971200 });
});
test('rejects missing data rather than inventing a price', () => {
  assert.throws(() => parseChart({ chart: { result: [] } }, 'X'));
  assert.throws(() => parseChart({ chart: { result: [{ meta: {}, timestamp: [1], indicators: { quote: [{ close: [null] }] } }] } }, 'X'));
});
test('8-decimal conversion', () => {
  assert.equal(toUsd8(370.59), 37059000000n);
  assert.throws(() => toUsd8(0));
  assert.throws(() => toUsd8(Number.NaN));
});
