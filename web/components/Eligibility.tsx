"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Eligibility gate (spec C8).
 *
 * - Must be explicitly acknowledged before any actionable stock use.
 * - States that Coinbase tokenized stocks are restricted to eligible users in
 *   permitted jurisdictions OUTSIDE the US.
 * - Not described as KYC. OwnPay does not claim to verify legal eligibility.
 * - The disclosure stays accessible after acknowledgement (reopen link).
 */

const STORAGE_KEY = "ownpay.eligibility.ack.v1";

type Mode = "gate" | "disclosure";

type EligibilityContextValue = {
  acknowledged: boolean;
  /** Returns true if already acknowledged; otherwise opens the gate and returns false. */
  requireEligibility: () => boolean;
  /** Reopen the disclosure as read-only (no re-acknowledgement needed). */
  openDisclosure: () => void;
};

const EligibilityContext = createContext<EligibilityContextValue | null>(null);

export function useEligibility(): EligibilityContextValue {
  const ctx = useContext(EligibilityContext);
  if (!ctx) throw new Error("useEligibility must be used within EligibilityProvider");
  return ctx;
}

export function EligibilityProvider({ children }: { children: React.ReactNode }) {
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    // Lazy read: undefined on the server, real value on the client. Nothing in the
    // initial render output branches on this, so there is no hydration mismatch.
    try {
      return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("gate");

  const acknowledge = useCallback(() => {
    setAcknowledged(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  const requireEligibility = useCallback(() => {
    if (acknowledged) return true;
    setMode("gate");
    setOpen(true);
    return false;
  }, [acknowledged]);

  const openDisclosure = useCallback(() => {
    setMode(acknowledged ? "disclosure" : "gate");
    setOpen(true);
  }, [acknowledged]);

  const value = useMemo(
    () => ({ acknowledged, requireEligibility, openDisclosure }),
    [acknowledged, requireEligibility, openDisclosure],
  );

  return (
    <EligibilityContext.Provider value={value}>
      {children}
      {open && (
        <EligibilityModal
          mode={mode}
          onAcknowledge={acknowledge}
          onClose={() => setOpen(false)}
        />
      )}
    </EligibilityContext.Provider>
  );
}

function EligibilityModal({
  mode,
  onAcknowledge,
  onClose,
}: {
  mode: Mode;
  onAcknowledge: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "disclosure") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="elig-title"
      style={overlay}
      onClick={mode === "disclosure" ? onClose : undefined}
    >
      <div className="panel" style={sheet} onClick={(e) => e.stopPropagation()}>
        <div className="stack" style={{ ["--gap" as string]: "14px" }}>
          <span className="pill pill-accent" style={{ alignSelf: "flex-start" }}>Eligibility</span>
          <h2 id="elig-title" style={{ fontSize: 21 }}>A note before you use tokenized stock</h2>
          <p className="soft" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
            Coinbase tokenized stocks are available only to eligible users in permitted
            jurisdictions <strong>outside the United States</strong>. OwnPay is a self-custodial
            interface — it does not verify your legal eligibility and is not available to everyone
            worldwide.
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            This is not identity verification (KYC). By continuing you confirm you understand these
            restrictions and are responsible for your own eligibility.
          </p>

          {mode === "gate" ? (
            <div className="row" style={{ marginTop: 4 }}>
              <button className="btn btn-primary btn-block" onClick={onAcknowledge}>
                I understand and I&apos;m eligible
              </button>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 4 }}>
              <button className="btn btn-ghost btn-block" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10, 20, 19, 0.42)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: 0,
  zIndex: 60,
};

const sheet: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  borderBottom: "none",
};
