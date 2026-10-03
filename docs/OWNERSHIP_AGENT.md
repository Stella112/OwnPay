# OwnPay Ownership Agent

The Ownership Agent is an isolated server-side worker. It is not executed in
the Next.js browser and it never receives a user private key.

## M4 currently implemented

The worker can:

1. scan canonical Base USDC `Transfer` logs;
2. identify wallets with saved OwnPay rules;
3. enforce minimum payments and daily/monthly integer limits;
4. calculate an auditable raw-unit allocation;
5. deduplicate by `chainId`, transaction hash, and log index; and
6. persist payment events, cursors, and blocked execution receipts.

The default mode is `observe`. Every eligible event is fail-closed with a
reason such as `AGENT_OBSERVE_MODE`, `DAILY_LIMIT`, or
`AGENT_AUTHORITY_NOT_CONFIGURED`.

## M5 authority controls implemented

The `/automation` dashboard now provides a guarded Privy delegation flow and
separate `Pause Automation` / `Revoke Agent Access` controls. The server only
records an active authority after checking wallet ownership in the identity
token and verifying its address and configured signer through Privy's server
API. The worker checks that record before planning
an action and blocks paused, revoked, or unconfigured authority.

Authority is separate from route availability. The worker has strict USDC→B20
and USDC→cNGN→DPRI adapters. Provider access, quotes, signing authority and
route configuration must all be available before a purchase can run.

## DPRI income route

The worker includes a separate `USDC → cNGN → DPRI` adapter, not a B20 swap.
GetEquity's verified market is `0x716B0B731f2FB292C74BD121485d930FA3dEA2DD`.
Its `buy(token, amount, maxCost)` transfers DPRI to the calling user wallet.
The adapter pins the verified proxy implementation and payout token; a proxy
upgrade blocks execution until reviewed.

The route checks the Privy wallet ID against the recipient, requests an exact
USDC-input quote, reads the market price and inventory, waits for confirmed
cNGN output, simulates an exact approval and purchase, and verifies the DPRI
transfer in the purchase receipt. Each signing stage is durably recorded.
Daily/monthly limits include pending and partial executions across rule versions.
Pause/revoke and rule changes are rechecked before each signing stage.

If the swap succeeds but the purchase fails, cNGN remains in the user's wallet.
PARTIAL and interrupted executions require review; the worker never blindly
repeats the swap. Mixed DPRI/B20 allocations are currently blocked. The wallet
needs Base ETH for gas. This is not a claim of guaranteed execution or liquidity.

On September 30, 2026, a **read-only production quote** returned HTTP 403:
`Swaps are not enabled for this app`. The DPRI route is therefore disabled.
Request swaps access from Privy, then run this read-only check with deployment
environment variables loaded:

```sh
cd web
node scripts/check-income-route.mjs
```

Before enabling `OWNPAY_DPRI_ROUTE_ENABLED=true`, verify a live USDC/cNGN quote,
market inventory, user delegation and an end-to-end user-approved small purchase.
Do not mark it live based only on unit tests. No transaction was signed in the
production diagnostic. Saving a rule and resuming are separate user actions.

The worker now requests logs only for wallets with enabled rules, catches up
without the polling delay, ignores payments before a rule was created, and
advances directly to the head when there are no rules. No old records are deleted.

## Remaining work

- Privy swaps access and live USDC/cNGN liquidity verification
- user-approved end-to-end DPRI validation, then route enablement
- reconciliation UI for interrupted/partial receipts
- Privy signer-policy hardening (current limits are enforced by OwnPay)
- ERC-8004 identity (M7)

There is no fallback venue or arbitrary calldata route.
## KyberSwap Base execution (October 2026)

The main B20 worker can use `OWNPAY_B20_VENUE=kyberswap` with
`OWNPAY_B20_ROUTE_ENABLED=true`. It obtains fresh unsigned routes from Kyber's
public Base aggregator; no 0x key or Privy swaps entitlement is needed. Privy
still supplies the explicitly delegated embedded-wallet transaction signer.
External wallets remain supported for manual payments; their balances do not
move into an embedded wallet automatically.

Only canonical Base USDC and the ten pinned B20 contracts are accepted. Router
`0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` and executor
`0x8F10B468b06c6FD214B65F87778827F7D113f996` are pinned from the official registry.
The adapter decodes the verified router ABI, binds spend/tokens/receiver/minimum
output, forbids fees/permits/unsafe flags, and approves only the exact spend.
Fresh builds are simulated and gas-checked before signing. Receipts must confirm
on Base and prove net stock delivery and exact USDC spend. Ambiguous phases stay
PARTIAL for operator review; they are never blindly replayed. Unconsumed exact
allowances after a failed swap may remain and should be reviewed/revoked.

Users must approve a saved rule, grant access, then resume. The review displays
slippage (new form defaults to 1%; old rules retain their approved value). Only
new qualifying income to the rule wallet triggers purchases; no retroactive
investment or permission grants occur during deployment. Base ETH is needed
for gas and issuer/jurisdiction eligibility still applies. DPRI is separate and
disabled; this integration does not enable it. LI.FI and CoW are not execution
fallbacks in this release.

Read-only production check: `node scripts/check-kyber-routes.mjs`.
Tests: `npm run agent:test`. A passing unsigned quote is not a completed purchase;
a funded, user-authorized wallet is required for an end-to-end transaction.
