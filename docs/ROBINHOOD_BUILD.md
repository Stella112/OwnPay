# OwnPay OwnRules — Robinhood Chain Testnet

**Submission status: not yet submission-ready.** Contracts are deployed and a
wallet-paid real-testnet demo is complete. A distinct temporary test signer also
executed one delegated income split successfully. ZeroDev sponsorship, browser email
onboarding, and a persistent production-style watcher are not yet verified. Evidence
files report checks actually run; no contract address is fabricated.

## Product and financial execution

Money arrives. OwnPay knows what should happen next.

For a 70/10/20 rule and 100 USDG routed payment:

1. Sender authorizes exact USDG allowance (or Kernel batches approval/payment).
2. Onchain policy checks rule enabled, maximum payment and cumulative daily cap.
3. Local test compliance policy checks payer and recipient, expiry and block flag.
4. 70 USDG actually transfers to recipient owner, 10 goes into savings escrow,
   20 stays as ownership USDG reserve or transfers to an approved ownership adapter.
5. Optional acquired assets enter a funded linear vesting escrow (up to one year).
6. `PaymentReceipt` records amounts, rule version and encrypted-note commitment.
7. Owners redeem savings/reserve; vested claims always pay their named recipient.

Default reserve is **USDG, not acquired Stock Tokens**. The optional DEMO-OWN
asset has no value and no backing. The public registry response checked for this
build had no entries on chain 46630; faucet-provided test stock balances do not
establish that these are official tokenized-stock deployments. The checked external
swap route fails with stale oracle prices and is not integrated.
Asset output is checked against actual
received balances and minimum output; failures roll back the entire payment.

## Accounts and automation

- Existing Base routes remain unchanged. Hackathon UI is `/robinhood`.
- Email mode uses the Privy embedded signer, never an external wallet fallback.
- Receive account is a purpose-limited custom contract owned by that signer.
- Send new test USDG to the receive account for income automation. Spendable
  proceeds go to the named owner wallet; escrow remains in OwnRules.
- Direct transfers to the signer wallet do not automatically trigger a split.
- Agent can process pending USDG only under owner delegation, expiry, exact rule
  version, recipient, adapter and max/daily cap. Rule/vesting edits revoke authority.
- Agent code scans bounded onchain logs and persists a checkpoint; no Neon DB
  polling. A separate-key, one-shot rehearsal succeeded, but no persistent
  Robinhood worker is currently running on the VPS.
- Default agent mode is observe. Execute requires a separately funded test agent
  key and explicit owner authorization. No Base transactions are sent by this agent.
- Direct account deposits have no trusted payer identity onchain. This test
  implementation checks recipient eligibility but does not provide provenance or
  sanctions screening. Never describe it as regulatory compliance certification.

## Sponsorship modes

Custom relay sponsors first **ten signed configuration/withdrawal intents** for
explicitly allowlisted test accounts, using the onchain nonce quota. This is NOT
ten payments and not a 4337 paymaster. It refuses arbitrary targets/calldata,
expired/invalid signatures and wrong chain. Sponsor is separate from owner.

Optional ZeroDev Kernel mode uses official installed SDKs and provider policies.
The UI verifies chain and required deployed infrastructure before activation.
It batches exact approval plus payment and only reports success after a confirmed
successful user-operation receipt. No configured project = disabled activation.
Configure its provider gas policy to allow only the deployed router/token/vesting,
approved methods and users, with spending/budget quotas. First-ten-payment quotas
for ZeroDev are a provider-policy requirement, **not implemented by our intent nonce**.

## Reproducible commands

From `contracts`: `npm ci`, `npm test`, `npm run verify:robinhood`,
`npm run deploy:robinhood`, `npm run demo:robinhood`.
Deployer is read from ignored `contracts/.env`. Never commit keys.

After deployment, the policy administrator can explicitly authorize a demo owner
using `npm run policy:robinhood`, with `ROBINHOOD_TEST_POLICY_OWNER`,
`ROBINHOOD_TEST_POLICY_DECISION=allow|block` and `ROBINHOOD_TEST_POLICY_HOURS=1..24`.
Approve the actual selected account (Kernel address in Kernel mode), not a different
signer or external wallet. Both routed payer and recipient need local test eligibility.
This command does not claim that either person passed real KYC.

From `web`: `npm ci`, `npm run agent:test`, `npx tsc --noEmit`,
`npm run build:vps`, `node scripts/verify-robinhood-kernel.mjs`.

Configure deployed contract values from `contracts/deployments/robinhood-testnet.json`
in the server runtime, using `deploy/robinhood.env.example`. Contract addresses are
runtime server config; `NEXT_PUBLIC_ROBINHOOD_ZERODEV_RPC` is a build-time value.
Do not expose raw private keys/API secrets in NEXT_PUBLIC variables.

`deploy-robinhood.js` checks network/USDG, deploys router+vesting+demo adapter/asset,
checkpoints confirmed deployments for safe resumption, verifies code and writes
a public manifest. The demo checks actual balances, funded vesting and claims and
records explorer links in `docs/evidence/robinhood-demo.json`. Reproducible live
negative checks use `eth_call`; reverted transactions are not fabricated.

The shared VPS release is staged in `/opt/ownpay/releases/robinhood-20261003`.
The initial build exceeded its 768 MB heap cap. The retry disables Webpack cache
and runs inside a resource-capped service; neither attempt restarts the Base app.
Use `deploy/ecosystem.robinhood-preview.config.cjs` only for loopback smoke tests.
Frontend HTTP checks are not proof of authenticated wallet execution.

The clean Linux production build and its TypeScript checks passed. The loopback
smoke checked `/robinhood`, `/`, `/app`, `/pay`, `/portfolio`, `/automation` and
their static assets. The status API correctly returned 503 for undeployed contracts.
35 contract tests and 23 existing agent-route tests pass. A real-network constructor
`eth_call` also succeeded; `evidence/robinhood-constructor.json` explicitly records
simulation only, not a persistent deployment. The subsequent funded deployment
is recorded in `../contracts/deployments/robinhood-testnet.json`. The real payment
demo in `evidence/robinhood-demo.json` verifies 70/10/20, withdrawals, delegated
income processing, a fully claimed funded vesting grant and blocked-payment refusal.
The separate one-shot worker run in `evidence/robinhood-worker.json` used a
temporary signer, which processed 1 USDG into 0.7 spendable / 0.1 savings /
0.2 DEMO-OWN and was then revoked. It proves one delegated execution, not a
persistent autonomous service, a sponsored user operation or browser onboarding.

Frontend published at [ownpay.online/robinhood](https://ownpay.online/robinhood).
Public HTTPS checks passed for the new page and existing Base pages/static assets.
The testnet status API now returns 200 and reads the verified deployed contracts.
Live script-driven payment verification succeeded; authenticated browser verification
is not claimed.
The temporary preview process was stopped after testing. The Base agent was not
restarted or replaced. The owner subsequently authorized saving PM2's shared startup
snapshot; it was saved with the connected frontend configuration. Reboot recovery
has not been tested.

## Demo rehearsal (only after real testnet verification)

1. Open `/robinhood`; say clearly that it is Robinhood testnet and no-value assets.
2. Sign in by email; show signer and receive-account addresses, explain the roles.
3. Save 10% savings / 20% ownership / 70% spendable and limits.
4. Show expiry-limited local policy eligibility and authorize agent.
5. Send 100 test USDG via payment link; show 70/10/20 actual receipt and explorer.
6. Switch explicitly to DEMO-OWN adapter, optionally select vesting schedule.
7. Receive new test USDG; show agent processing, holdings/grant start and finish.
8. Claim a vested amount to the recipient; verify receipt and new asset balance.
9. Revoke agent or block recipient; show onchain refusal, no false success state.
10. Show withdrawal, audit trail and honest limitations.

Do not say "gasless" without successful sponsorship evidence. Do not present a
partially configured deployment as completed or label DEMO-OWN as Stock Tokens.

## Roadmap after submission

Verified real Stock Token venues and issuer jurisdiction requirements; independent
security audit; production compliance screening; robust log indexing; encrypted
metadata recovery/sharing; provider-backed first-ten-payment sponsorship policies;
webhook-driven automation; audited smart-account recovery; Arbitrum deployment
only **after** this Robinhood testnet submission.
