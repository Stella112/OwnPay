import type { Hex } from "viem";

/**
 * Shared memo encoder/decoder (spec A9, C6). One implementation for Pay, Gift,
 * Tip and claim display.
 *
 * A memo is stored onchain as `bytes32`. We encode the UTF-8 bytes and right-pad
 * with zeros. If the UTF-8 encoding does not fit in 32 bytes we REJECT — never
 * silently truncate (which would corrupt multi-byte characters).
 */

export const MEMO_MAX_BYTES = 32;
export const ZERO_MEMO: Hex = `0x${"00".repeat(32)}`;

export class MemoTooLongError extends Error {
  byteLength: number;
  constructor(byteLength: number) {
    super("Memo is too long. Shorten it before continuing.");
    this.name = "MemoTooLongError";
    this.byteLength = byteLength;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** UTF-8 byte length of a memo string (what actually counts against the 32-byte cap). */
export function memoByteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Whether `text` fits in a bytes32 memo. */
export function isMemoValid(text: string): boolean {
  return memoByteLength(text) <= MEMO_MAX_BYTES;
}

/** Encode a memo string to a 0x-prefixed bytes32 hex. Throws MemoTooLongError if it does not fit. */
export function encodeMemo(text: string): Hex {
  const bytes = encoder.encode(text);
  if (bytes.length > MEMO_MAX_BYTES) throw new MemoTooLongError(bytes.length);
  const padded = new Uint8Array(MEMO_MAX_BYTES); // zero-filled
  padded.set(bytes);
  let hex = "0x";
  for (const b of padded) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/** Decode a bytes32 memo hex back to a string, stripping trailing zero padding. */
export function decodeMemo(hex: Hex): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  // Strip trailing zero bytes (padding).
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return decoder.decode(bytes.slice(0, end));
}

/** True if a bytes32 memo is all zeros (i.e. no memo). */
export function isEmptyMemo(hex: Hex): boolean {
  return /^0x0*$/.test(hex);
}
