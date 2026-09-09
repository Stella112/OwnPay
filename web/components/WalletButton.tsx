"use client";

import { PrivyLoginButton } from "@/components/PrivyLoginButton";

export function WalletButton() {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID ? <PrivyLoginButton /> : null;
}
