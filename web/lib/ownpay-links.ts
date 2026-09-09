import { getAddress, isAddress } from "viem";

export type OwnPayLinkMode = "pay" | "gift" | "tip";

const MODES: OwnPayLinkMode[] = ["pay", "gift", "tip"];
const BASENAME_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.base\.eth$/i;

export function isOwnPayLinkRecipient(value: string): boolean {
  const input = value.trim();
  return isAddress(input) || BASENAME_RE.test(input);
}

export function normalizeOwnPayLinkRecipient(value: string): string | undefined {
  const input = value.trim();
  if (isAddress(input)) return getAddress(input);
  if (BASENAME_RE.test(input)) return input.toLowerCase();
  return undefined;
}

export function isOwnPayLinkMode(value: string | null | undefined): value is OwnPayLinkMode {
  return !!value && MODES.includes(value as OwnPayLinkMode);
}

/** One canonical link builder shared by display, QR, copy, share, and download. */
export function buildOwnPayLink(recipient: string, mode?: OwnPayLinkMode): string {
  const normalized = normalizeOwnPayLinkRecipient(recipient);
  if (!normalized) throw new Error("Cannot create an OwnPay Link for an invalid recipient.");

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const base = configured || (typeof window !== "undefined" ? window.location.origin : "https://ownpay.online");
  const url = new URL(`${base}/p/${encodeURIComponent(normalized)}`);
  // The default page is Pay, so keep the canonical link short unless a mode is selected.
  if (mode && mode !== "pay" && isOwnPayLinkMode(mode)) url.searchParams.set("mode", mode);
  return url.toString();
}

export function ownPayFileName(recipient: string, mode?: OwnPayLinkMode): string {
  const normalized = normalizeOwnPayLinkRecipient(recipient) ?? "recipient";
  const label = normalized.replace(/\.base\.eth$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "recipient";
  return `ownpay-${label}${mode && mode !== "pay" ? `-${mode}` : ""}.png`;
}
