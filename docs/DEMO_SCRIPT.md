# OwnPay: demo video script (Robinhood Chain Testnet)

Target length: ~2:30. A 90-second cut is at the bottom.
Site: https://ownpay.online/robinhood

---

## Before you hit record (10 min)

1. Refresh the site and sign in. Check the top bar says **"Smart account · gas sponsored"**.
2. **Rules:** savings 10, ownership 20, max 100, daily 500. Weights: **TSLA 1, AMZN 1**. Save rule.
3. **Agent:** choose **7 days** → Authorize.
4. **Home:** make sure the wallet shows at least ~10 USDG.
5. Have a second address ready to paste for "Pay someone":
   `0xE66581C8f5B91d257b5EAa90168B547Ba28f8e19`
6. Dismiss any red banners. Close other tabs, zoom the browser to 110%.
7. **Market hours matter for the stock-buying moment:**
   - **Market open** (Mon–Fri, roughly 09:00–01:00 UK time including pre/after-hours): the ownership share buys TSLA/AMZN **instantly**.
   - **Market closed** (nights, weekends): it is **queued** and the agent buys at the next session. Both are fine to show. Use the line marked [CLOSED] or [OPEN] below.

Things to never say: "real money", "audited", "KYC", "Robinhood partnership", "guaranteed returns".

---

## Script

### 0:00–0:15 · Hook
**Screen:** Home page, balance cards visible.
**Say:**
> "Money arrives. OwnPay knows what to do. This is OwnPay on Robinhood Chain testnet: every payment you receive is automatically split into spending money, savings, and real stock ownership. Enforced on chain, not by an app."

### 0:15–0:35 · Gasless sign-in
**Screen:** point at the top bar (address + "Smart account · gas sponsored").
**Say:**
> "I signed in with just my email. OwnPay gave me a smart account, and every action is gas-sponsored. This wallet holds zero ETH, and I never need any."

### 0:35–1:00 · The rule
**Screen:** Rules page. Show the split (80/10/10 or 70/10/20) and the TSLA / AMZN weights with live prices.
**Say:**
> "Here's my rule. Seventy percent stays spendable, ten goes to savings, twenty becomes ownership. And I choose what I own: half Tesla, half Amazon, priced from the real market, with a live open-or-closed status. Up to five stocks."

### 1:00–1:35 · Money arrives (the key moment)
**Screen:** Agent page briefly ("Online · execute", "Authorized"), then Home → Add money → 5 → **Move USDG from my wallet**. Wait ~10 seconds, click Refresh.
**Say:**
> "I've authorized the OwnPay agent. It can only split money under my rule. It can't send funds anywhere else, and I can revoke it any time. Now money arrives in my receive account…"

*(after it updates)*
> "…and within seconds, without me clicking anything, the agent split it: spendable in my wallet, savings in escrow…"

**[OPEN]** > "…and the ownership share just bought Tesla and Amazon at the market price."
**[CLOSED]** > "…and because the market is closed right now, the ownership share is queued. The agent buys my Tesla and Amazon automatically at the next market session, like a broker queuing an after-hours order."

**Screen:** "What just happened" shows **"Agent split 5 USDG…"** (and "Bought … TSLA" if open).

### 1:35–1:55 · Compliance you control
**Screen:** Compliance page.
**Say:**
> "Compliance is programmable and it's mine. I can accept payments only from senders I approve, block addresses, require an invoice note, or cap how much one sender can pay me per day. The contract enforces it. No administrator can approve or block anyone on my behalf."

### 1:55–2:15 · Pay, gift and tip in stock
**Screen:** Stocks page → Gift, TSLA, paste the second address, 0.1, "Unlocks in 1 minute" → Send stock gift. Show it in "Your stock grants".
**Say:**
> "I can also pay, gift or tip in stock. Here's a Tesla gift that unlocks in a minute. Vesting grants work the same way, and the employer can revoke whatever hasn't vested yet."

### 2:15–2:30 · Proof and close
**Screen:** Activity page, click any "view on explorer" link.
**Say:**
> "Every payment, split, purchase and agent action is on chain and auditable. Built on Robinhood Chain testnet with test USDG and faucet stock tokens. OwnPay: every payment can become ownership."

---

## 90-second cut
Use: Hook (0:00–0:15) → Rule (0:35–1:00) → Money arrives (1:00–1:35) → Close (2:15–2:30). Mention "gas-sponsored, email sign-in" in one sentence during the Hook.

---

## Honest notes (for the submission text, not the video)
- Testnet only: test USDG, faucet-issued stock tokens with no monetary value.
- Stock prices come from public market data (Yahoo Finance) relayed on chain with the market's own timestamp. The stock desk is an OwnPay-run testnet venue, not a DEX.
- Gas sponsorship: ZeroDev on Robinhood testnet (currently "sponsor all" with no cap; to be restricted to OwnPay contracts).
- Compliance is recipient-set rules, not identity verification or sanctions screening.
- Contracts: OwnRules v3 `0x4F4Fe524a782C576E4dF027E911c6dAA00115c40`, stock desk `0x688279Dbf5731eDA609eA0A8D209Cd09665044A5`.
