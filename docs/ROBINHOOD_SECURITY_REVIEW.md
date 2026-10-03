# Scoped engineering security review

This is an internal review, not an independent audit or production approval.

## Implemented controls tested locally

- Financial splits conserve integer USDG amounts, including rounding/dust cases.
- Transfers and ownership acquisition revert atomically on adapter failure.
- Adapter output is measured from received balances, not its claimed return value.
- Reentrancy and dishonest adapter tests preserve payer funds.
- Only owners edit rules; agents cannot change recipients, assets or allocation.
- Delegation is expiry- and rule-version-bound; edits revoke previous authority.
- Explicit compliance expiry/block checks fail closed on routed payments.
- Signed intents bind chain, router, owner, action, data hash, deadline and nonce.
- Invalid, expired and replayed signatures are rejected.
- Vesting is funded before credit and claims always pay the named owner.
- Relay only exposes known router actions to allowlisted test owners; no arbitrary
  destination or calldata forwarding. Sponsorship is disabled without a signer.
- Email UI never selects an injected external wallet as the embedded account.
- User-operation success and transaction receipts are checked before reporting success.

## Open limitations and gates

- Live wallet-paid deployment/demo receipts and a separate-key one-shot worker
  receipt now exist. Browser email onboarding and a persistent worker service have
  not yet been verified.
- ZeroDev infrastructure verification is not evidence of working sponsorship.
  A project endpoint, restrictive gas policy, budget and real user-op receipt are needed.
- Local policy administration is not identity, sanctions or jurisdiction screening.
  Receive-account deposits lack trusted payer provenance.
- DEMO-OWN has no value, price discovery, backing, redemption or equity rights.
  Its test USDG proceeds go to the explicitly disclosed demo treasury.
- Encrypted notes have browser-local key storage, no recovery and no XSS protection.
  Addresses and financial amounts remain public. This is not transaction privacy.
- The agent uses a bounded log checkpoint and two-block delay, not a production
  reorg-safe indexer. Run only one instance per checkpoint and dedicated signer.
- Historical receipts and grants are bounded in the UI; older data remains onchain.
- Exact dependency-audit results are in `docs/evidence/dependency-audit.json`.
  The latest full audit has 23 moderate findings and five high dependency-chain
  findings from one unpatched `braces` lint-tool advisory. The production-only
  audit has 23 moderate findings and zero high/critical findings. Build/lint must
  use trusted repository patterns only; this mitigation is not an upstream fix.
  See [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  Moderate connector dependencies remain unresolved. This is not a vulnerability-free claim.
- The custom relay quota is ten configuration/withdrawal intents, not ten sponsored
  payments. Provider payment quotas must be enforced separately.
- Production use requires independent contract audit, operational rate limits,
  signer custody controls, monitored sponsorship budgets and verified issuer routes.

Contract tests, TypeScript, lint and builds are necessary checks, not substitutes
for live integration tests. Testnet execution is evidenced; submission remains
incomplete until sponsorship and browser onboarding are verified and the intended
worker deployment mode is demonstrated end to end.
