import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const MODES = [
  { href: "/pay", title: "Pay", blurb: "Grant stock that vests over time. Revocable if plans change.", mark: "P" },
  { href: "/gift", title: "Gift", blurb: "An irreversible stock gift that unlocks all at once.", mark: "G" },
  { href: "/tip", title: "Tip", blurb: "Send stock instantly, with a memo, in one tap.", mark: "T" },
];

export default function Home() {
  return (
    <AppShell>
      <div className="container">
        <section style={{ paddingTop: 18, paddingBottom: 8 }}>
          <p className="pill pill-accent" style={{ display: "inline-flex" }}>Real stock · on Base</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(34px, 10vw, 46px)", letterSpacing: "-0.02em", marginTop: 16, lineHeight: 1.05 }}>
            Stock you can send, gift and vest.
          </h1>
          <p className="soft" style={{ fontSize: 16.5, marginTop: 14, lineHeight: 1.5 }}>
            OwnPay turns Coinbase tokenized stocks from something you trade into something you can
            program into compensation, gifts and rewards.
          </p>
        </section>

        <nav className="stack" style={{ ["--gap" as string]: "12px", marginTop: 22 }} aria-label="Choose an action">
          {MODES.map((m) => (
            <Link key={m.href} href={m.href} className="panel" style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "var(--ink)" }}>
              <span aria-hidden style={{
                width: 42, height: 42, borderRadius: 12, flex: "0 0 auto",
                background: "var(--accent-tint)", color: "var(--accent-strong)",
                display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20,
              }}>{m.mark}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{m.title}</span>
                <span className="muted" style={{ display: "block", fontSize: 13.5, marginTop: 2 }}>{m.blurb}</span>
              </span>
              <span aria-hidden className="muted" style={{ fontSize: 20 }}>›</span>
            </Link>
          ))}
        </nav>

        <p className="muted" style={{ fontSize: 12.5, marginTop: 22, lineHeight: 1.5 }}>
          Contract deployed to Base and readable on Basescan. Internally tested; not audited.
          Tokenized stocks are limited to eligible users in permitted jurisdictions outside the US.
        </p>
      </div>
    </AppShell>
  );
}
