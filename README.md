# OwnPay

Pay, gift, and tip people with real Coinbase B20 tokenized stocks on **Base**.

OwnPay turns tokenized stocks from something you *trade* into something you can
*program* into compensation, gifts, and rewards:

- **Pay** — grant stock that vests over time (revocable by the employer).
- **Gift** — an irreversible stock gift that unlocks all-at-once on a date.
- **Tip** — send stock instantly with an onchain memo.

## Repository layout

```
contracts/   Hardhat project: StockVesting.sol escrow + tests + deploy script
web/         Next.js app: wallet, Pay/Gift/Tip flows, mobile claim page  (in progress)
```

## Design principles (from the build spec)

- **RAW-unit accounting.** All escrow/vesting math is in RAW B20 units, so it stays
  correct across B20 multiplier (corporate-action) changes. UI/scaled conversion is
  a *display* concern handled by a single centralized helper.
- **Event-sourced grant ids.** A grant's id is read from the `GrantCreated` receipt
  event, never inferred as `grantCount - 1`.
- **No fabrication.** Mainnet claims (deploy address, tx hashes, Basescan links) are
  only asserted with real evidence. Nothing here fakes balances or transactions.

## Build status

See [`docs/STATUS.md`](docs/STATUS.md) for the honest, evidence-based state of each
component and exactly which steps require a funded wallet (deploy, real grants) that
must be run by the project owner, not automated.

## Contracts — local verification

```bash
cd contracts
npm install
npm test        # runs the StockVesting test suite against a local chain
```

Deployment to Base mainnet requires a funded deployer key; see
[`contracts/.env.example`](contracts/.env.example) and `scripts/deploy.ts`.
