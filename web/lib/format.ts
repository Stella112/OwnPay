import { formatUnits, parseUnits } from "viem";

/**
 * Parse a human amount string into a UI integer in the token's base units
 * (spec A6: human -> parseUnits(input, decimals) -> UI integer). The result is
 * then converted to RAW via uiToRaw() before it touches a transaction.
 */
export function parseUiAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Enter a valid amount.");
  }
  const value = parseUnits(trimmed, decimals);
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

/**
 * Format a UI base-unit amount to a display string with tabular-friendly
 * precision. Keeps enough decimals to make small fractional grants meaningful
 * (spec B2) while trimming noise.
 */
export function formatUiAmount(
  uiBaseUnits: bigint,
  decimals: number,
  opts: { maxFractionDigits?: number; minFractionDigits?: number } = {},
): string {
  const { maxFractionDigits = 6, minFractionDigits = 2 } = opts;
  const full = formatUnits(uiBaseUnits, decimals); // exact decimal string
  const [intPart, fracPartRaw = ""] = full.split(".");

  // Round to maxFractionDigits without floating point.
  const frac = fracPartRaw.slice(0, maxFractionDigits);
  const nextDigit = fracPartRaw[maxFractionDigits];
  if (nextDigit && Number(nextDigit) >= 5) {
    // round up the fractional part (may carry into integer part)
    const rounded = (BigInt(intPart + frac.padEnd(maxFractionDigits, "0")) + 1n).toString();
    const padded = rounded.padStart(intPart.length + maxFractionDigits, "0");
    const cut = padded.length - maxFractionDigits;
    return trimFraction(padded.slice(0, cut), padded.slice(cut), minFractionDigits);
  }
  return trimFraction(intPart, frac, minFractionDigits);
}

function trimFraction(intPart: string, frac: string, minFractionDigits: number): string {
  let f = frac.replace(/0+$/, "");
  while (f.length < minFractionDigits) f += "0";
  const intFmt = withThousands(intPart);
  return f.length > 0 ? `${intFmt}.${f}` : intFmt;
}

function withThousands(intPart: string): string {
  const neg = intPart.startsWith("-");
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${grouped}` : grouped;
}

/** Format a unix seconds timestamp to a short human date. */
export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Human-readable countdown to a future unix timestamp; "" if already passed. */
export function formatCountdown(targetUnix: number, nowUnix: number): string {
  let s = targetUnix - nowUnix;
  if (s <= 0) return "";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
