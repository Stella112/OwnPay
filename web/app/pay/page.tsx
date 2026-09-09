import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { GrantComposer } from "@/components/GrantComposer";

export default function PayPage() {
  return (
    <AppShell>
      <div className="container stack" style={{ ["--gap" as string]: "18px" }}>
        <Link href="/" className="muted" style={{ fontSize: 13 }}>‹ Back</Link>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: "-0.02em" }}>Pay in stock</h1>
          <p className="soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>
            Grant stock that vests over time. You can revoke the unvested portion if plans change.
          </p>
        </div>
        <GrantComposer mode="pay" />
      </div>
    </AppShell>
  );
}
