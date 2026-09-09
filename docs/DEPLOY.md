# OwnPay — Mainnet Deploy Runbook (turnkey)

Everything is prepared so you can go live on Base with a short, signed sequence.
**You** run these steps and sign the transactions — nothing here hands your key to
anyone, and no step is automated on your behalf.

Ground rules already enforced in the code:
- The deployer key is read from `contracts/.env` only. It is **never** logged and
  **never** placed in any `NEXT_PUBLIC_*` variable (those ship to the browser).
- The official AAPLc / NVDAc addresses are already verified and baked into the
  allowlist (`web/lib/tokens.ts`), so there is nothing to configure there.
- With no `web/.env.local`, the app runs in Base-mainnet mode and shows the honest
  "Not configured yet" state until you set the deployed contract address.

---

## 1. One-time setup

```bash
cd contracts
cp .env.example .env
```

Fill `contracts/.env`:
- `DEPLOYER_PRIVATE_KEY` — a **dedicated** deployer key (not a personal wallet).
  Fund it with a small amount of ETH on Base (deploy costs a few cents).
- `BASE_RPC_URL` — e.g. `https://mainnet.base.org` (or your own RPC).
- `BASESCAN_API_KEY` — an Etherscan v2 multichain key (used for verification).

## 2. Deploy the escrow contract

```bash
cd contracts
npm run deploy:base
```

This deploys **only** `StockVesting` (it never holds your funds or creates grants).
Copy the printed address — call it `<VESTING>`.

## 3. Point the app at the deployed contract

Create `web/.env.local`:

```bash
NEXT_PUBLIC_STOCK_VESTING_ADDRESS=<VESTING>
```

Do **not** set `NEXT_PUBLIC_ENABLE_LOCAL` here (that is only for the local dev pass).
The token addresses are already configured; no other env is required.

## 4. Verify the source on Basescan

```bash
cd contracts
npm run verify -- <VESTING>
```

Confirm the green "Contract Source Code Verified" badge at
`https://basescan.org/address/<VESTING>#code`.

## 5. Build & run the app

```bash
cd web
npm run build && npm start
```

## 6. Create ONE real demo grant + claim + tip (tiny amounts)

You need a small amount of a tokenized stock (e.g. ~**0.01 AAPLc**) in your wallet
on Base. In the app (connect that wallet, acknowledge the eligibility note):

1. **Pay** → asset **AAPLc**, recipient = your second address (or a friend's),
   amount **0.01**, schedule **Demo · 15s cliff, 60s vest**, memo `2026 contributor`.
   Approve, then Create grant. Save the **create** tx hash and the `/claim/<id>`.
2. Open `/claim/<id>`, wait past the 15s cliff, watch the figure vest, then
   **Claim**. Save the **release** tx hash; confirm the recipient balance changed.
3. **Tip** → **AAPLc**, amount **0.01**, memo `thanks`. Save the **tip** tx hash.

Each signature is yours; the app only prepares the calldata and shows the hashes.

---

## Fill-in checklist (paste results here / into Devpost)

- [ ] StockVesting address: `0x________________________________________`
- [ ] Basescan source verified: `https://basescan.org/address/0x____#code`
- [ ] Pay createGrant tx: `0x________________________________________`
- [ ] Claim release tx: `0x________________________________________`
- [ ] Tip transferWithMemo tx: `0x________________________________________`
- [ ] Live app URL: `____________________________________________`
- [ ] 90-second Loom URL: `____________________________________________`
- [ ] Eligibility (non-US) note visible in the demo: yes / no
