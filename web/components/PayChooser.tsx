"use client";

import { useState } from "react";
import { GrantComposer } from "@/components/GrantComposer";
import { UsdcPaymentComposer } from "@/components/UsdcPaymentComposer";

export function PayChooser({ initialRecipient = "", lockedRecipient = false }: { initialRecipient?: string; lockedRecipient?: boolean }) {
  const [asset, setAsset] = useState<"usdc" | "stock">("usdc");
  return <div className="stack" style={{ ["--gap" as string]: "18px" }}>
    <div><label>Pay with</label><div className="choice-grid"><button type="button" className="choice" aria-pressed={asset === "usdc"} onClick={() => setAsset("usdc")}><div className="k">USDC</div><div className="v">Direct payment on Base</div></button><button type="button" className="choice" aria-pressed={asset === "stock"} onClick={() => setAsset("stock")}><div className="k">Tokenized stock</div><div className="v">Vesting grant with B20 assets</div></button></div></div>
    {asset === "usdc" ? <UsdcPaymentComposer initialRecipient={initialRecipient} lockedRecipient={lockedRecipient} /> : <GrantComposer mode="pay" initialRecipient={initialRecipient} lockedRecipient={lockedRecipient} />}
  </div>;
}
