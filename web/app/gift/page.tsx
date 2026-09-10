import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { GrantComposer } from "@/components/GrantComposer";

export default function GiftPage() {
  return (
    <AppShell>
      <div className="container stack" style={{ ["--gap" as string]: "18px" }}>
        <Link href="/app" className="muted" style={{ fontSize: 13 }}>‹ Back to dashboard</Link>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: "-0.02em" }}>Gift stock</h1>
          <p className="soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>
            An irreversible gift that unlocks in full on the date you choose. No take-backs.
          </p>
        </div>
        <GrantComposer mode="gift" />
      </div>
    </AppShell>
  );
}
