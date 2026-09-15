# OwnPay

OwnPay is a Base-native payments app that turns everyday money movement into
programmable ownership.

People can use one OwnPay Link to pay, gift, or tip in USDC and eligible Coinbase
B20 tokenized stocks. Senders can define how qualifying payments become
ownership, while recipients claim assets to their own embedded wallet and track
the result in a dedicated portfolio.

OwnPay turns tokenized stocks from something you only *trade* into something you
can *program* into compensation, gifts, and rewards:

- **Pay** — grant stock that vests over time and can be revoked before vesting.
- **Gift** — send an irreversible stock gift that unlocks all at once on a date.
- **Tip** — send stock instantly with an onchain memo.
- **Portfolio** — see USDC, owned stock, vested grants, spending, sent payments,
  tips, and transaction history in one place.

Live app: [ownpay.online](https://ownpay.online)

## Repository layout

```
contracts/   Hardhat project: StockVesting.sol escrow + tests + deploy script
web/         Next.js app: wallet, Pay/Gift/Tip flows, mobile claim page  (in progress)
```

## Why OwnPay

Traditional payment tools stop at settlement. OwnPay adds an ownership layer
that makes compensation and community rewards more durable. A business can
send a grant instead of a promise, a creator can receive tips that build a
portfolio, and a recipient can see exactly what they own and what is still
vesting.

The product is designed around self-custody, Base mainnet, verified asset
contracts, explicit user approval, and honest onchain balances. OwnPay does not
invent stock prices, balances, or transaction history.

## The future

OwnPay is starting with the core rail: Base payments, gifts, tips, vesting, and
portfolio visibility. The longer-term goal is to make ownership programmable
enough to support the way people actually work, earn, and reward one another.

Planned directions include:

- **USDC-to-ownership rules** — let users decide what portion of qualifying USDC
  payments should become eligible tokenized-stock ownership.
- **More official B20 assets** — expand the supported stock catalog as verified
  assets and compliant distribution routes become available.
- **Recurring ownership** — support recurring grants, employer matches, and
  stock-back rewards for ongoing work or spending.
- **A safer ownership agent** — allow users to delegate narrowly scoped,
  revocable actions within saved limits, with every action validated against
  approved Base assets and contracts.
- **Better discovery and portability** — make OwnPay Links easier to share and
  help recipients take their self-custodied ownership wherever they use Base.
- **Lower-friction transactions** — revisit sponsorship and batching when the
  production funding and infrastructure are ready, without compromising user
  approval or transaction transparency.

These are future directions, not promises that every feature is available
today. See [`docs/STATUS.md`](docs/STATUS.md) for the evidence-based status of
each component and the owner-only steps required for real mainnet contract
deployment and live grant activity.

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
[`contracts/.env.example`](contracts/.env.example), [`docs/DEPLOY.md`](docs/DEPLOY.md), and `contracts/scripts/deploy.js`.
