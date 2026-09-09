import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { TipComposer } from "@/components/TipComposer";

export default function TipPage() {
  return (
    <AppShell>
      <div className="container stack" style={{ ["--gap" as string]: "18px" }}>
        <Link href="/" className="muted" style={{ fontSize: 13 }}>‹ Back</Link>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: "-0.02em" }}>Tip in stock</h1>
          <p className="soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>
            Send stock instantly with a memo. No vesting, no escrow — it lands right away.
          </p>
        </div>
        <TipComposer />
      </div>
    </AppShell>
  );
}
