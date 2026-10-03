"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";

export function PrivyLoginButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { disconnect } = useDisconnect();
  if (!ready) return <button className="btn btn-primary" disabled>Loading…</button>;
  if (authenticated) {
    return <button className="btn btn-ghost" onClick={() => { disconnect(); void logout(); }}>Sign out</button>;
  }
  return <button className="btn btn-primary" onClick={login}>Sign in / Sign up</button>;
}
