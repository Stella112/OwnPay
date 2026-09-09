"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { OwnPayIcon } from "@/components/OwnPayIcon";

export function LandingPrimaryCta() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <Link href="/app" className="btn btn-primary btn-large">Get started <OwnPayIcon name="arrow" size={18} /></Link>;
  }

  return <PrivyLandingCta />;
}

function PrivyLandingCta() {
  const { ready, authenticated, login } = usePrivy();

  if (!ready) return <button className="btn btn-primary btn-large" disabled>Loading…</button>;
  if (authenticated) return <Link href="/app" className="btn btn-primary btn-large">Go to dashboard <OwnPayIcon name="arrow" size={18} /></Link>;
  return <button className="btn btn-primary btn-large" onClick={login}>Sign in / Sign up <OwnPayIcon name="arrow" size={18} /></button>;
}
