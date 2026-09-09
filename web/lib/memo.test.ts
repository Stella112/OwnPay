import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeMemo,
  decodeMemo,
  isMemoValid,
  memoByteLength,
  isEmptyMemo,
  MemoTooLongError,
  MEMO_MAX_BYTES,
} from "./memo.ts";

test("round-trips an ASCII memo", () => {
  const hex = encodeMemo("2026 contributor");
  assert.equal(hex.length, 66); // 0x + 64 hex chars
  assert.equal(decodeMemo(hex), "2026 contributor");
});

test("round-trips an emoji (multi-byte) memo within 32 bytes", () => {
  const s = "gift 🎁 thanks";
  assert.ok(memoByteLength(s) <= MEMO_MAX_BYTES);
  assert.equal(decodeMemo(encodeMemo(s)), s);
});

test("accepts exactly 32 bytes", () => {
  const s = "x".repeat(32);
  assert.equal(memoByteLength(s), 32);
  assert.ok(isMemoValid(s));
  assert.equal(decodeMemo(encodeMemo(s)), s);
});

test("rejects 33 bytes — no silent truncation", () => {
  const s = "x".repeat(33);
  assert.equal(isMemoValid(s), false);
  assert.throws(() => encodeMemo(s), MemoTooLongError);
});

test("rejects a multi-byte string that overflows on encoding", () => {
  // Each 🎁 is 4 UTF-8 bytes; 9 of them = 36 bytes > 32.
  const s = "🎁".repeat(9);
  assert.ok(memoByteLength(s) > MEMO_MAX_BYTES);
  assert.throws(() => encodeMemo(s), MemoTooLongError);
});

test("empty memo detection", () => {
  assert.ok(isEmptyMemo(encodeMemo("")));
  assert.equal(isEmptyMemo(encodeMemo("hi")), false);
});
