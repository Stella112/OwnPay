import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUiAmount, formatUiAmount, formatCountdown } from "./format.ts";

test("parseUiAmount converts a human string to UI base units", () => {
  assert.equal(parseUiAmount("0.01", 18), 10_000_000_000_000_000n);
  assert.equal(parseUiAmount("1", 6), 1_000_000n);
});

test("parseUiAmount rejects junk and non-positive", () => {
  assert.throws(() => parseUiAmount("", 18));
  assert.throws(() => parseUiAmount("abc", 18));
  assert.throws(() => parseUiAmount("0", 18));
  assert.throws(() => parseUiAmount(".", 18));
});

test("formatUiAmount keeps small fractional precision and trims noise", () => {
  // 0.0214 shares
  assert.equal(formatUiAmount(21_400_000_000_000_000n, 18, { maxFractionDigits: 6 }), "0.0214");
  // whole number keeps min 2 decimals
  assert.equal(formatUiAmount(5_000_000_000_000_000_000n, 18), "5.00");
});

test("formatUiAmount groups thousands", () => {
  assert.equal(formatUiAmount(1_234_567_000_000_000_000_000n, 18, { minFractionDigits: 0 }), "1,234.567");
});

test("formatUiAmount rounds at the cutoff", () => {
  // 0.12345650 -> 6 dp rounds to 0.123457 (round half up on the 7th digit which is 5)
  assert.equal(formatUiAmount(123_456_500_000_000_000n, 18, { maxFractionDigits: 6 }), "0.123457");
});

test("formatCountdown", () => {
  assert.equal(formatCountdown(100, 40), "1m 0s");
  assert.equal(formatCountdown(40, 100), "");
});
