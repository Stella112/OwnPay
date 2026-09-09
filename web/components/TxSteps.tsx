"use client";

import type { Hex } from "viem";
import { BASESCAN_TX } from "@/lib/explorer";

export type StepStatus = "pending" | "active" | "done" | "error";

export type TxStep = {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  hash?: Hex;
};

export function TxSteps({ steps }: { steps: TxStep[] }) {
  return (
    <ol className="stack" style={{ ["--gap" as string]: "10px", listStyle: "none", padding: 0, margin: 0 }}>
      {steps.map((s) => (
        <li key={s.key} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
          <StepDot status={s.status} />
          <div style={{ flex: 1 }}>
            <div className="spread">
              <span style={{ fontWeight: 550, fontSize: 14, color: s.status === "pending" ? "var(--ink-muted)" : "var(--ink)" }}>
                {s.label}
              </span>
              {s.status === "active" && <span className="muted" style={{ fontSize: 12 }}>working…</span>}
            </div>
            {s.detail && (
              <div className={s.status === "error" ? "field-error" : "field-hint"} style={{ marginTop: 2 }}>
                {s.detail}
              </div>
            )}
            {s.hash && (
              <a
                className="tnum"
                href={BASESCAN_TX(s.hash)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, display: "inline-block", marginTop: 3 }}
              >
                {s.hash.slice(0, 10)}…{s.hash.slice(-8)} ↗
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepDot({ status }: { status: StepStatus }) {
  const styles: Record<StepStatus, React.CSSProperties> = {
    pending: { borderColor: "var(--hairline-strong)", background: "var(--surface)" },
    active: { borderColor: "var(--accent)", background: "var(--accent-tint)" },
    done: { borderColor: "var(--accent)", background: "var(--accent)" },
    error: { borderColor: "var(--danger)", background: "var(--danger-tint)" },
  };
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        border: "2px solid",
        marginTop: 1,
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        ...styles[status],
      }}
    >
      {status === "done" && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.5L5 9.5L10 3" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {status === "active" && <span className="dot" style={{ color: "var(--accent)", width: 6, height: 6 }} />}
      {status === "error" && <span style={{ color: "var(--danger)", fontWeight: 700, fontSize: 12, lineHeight: 1 }}>!</span>}
    </span>
  );
}
