"use client";

import { usePrivy } from "@privy-io/react-auth";

export function PrivyLoginButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  if (!ready) return <button className="btn btn-primary" disabled>Loading…</button>;
  if (authenticated) return <button className="btn btn-ghost" onClick={() => logout()}>Sign out</button>;
  return <button className="btn btn-primary" onClick={login}>Sign in</button>;
}
