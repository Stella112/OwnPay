# OwnPay — Build Status (evidence-based)

This file tracks the **real** state of the build. Rows are only marked done when
there is verifiable evidence (passing tests, a compile, a real tx hash). "Should
work" is not evidence.

Last updated by the build session on 2026-09-09 (gas sponsorship deferred; normal Base mainnet wallet gas is active).

## Legend
- ✅ done + evidence
- 🚧 in progress
- ⛔ blocked on the owner (needs a funded wallet / real mainnet action)
- ▫️ not started

## Contract layer (`contracts/`)
| Item | State | Evidence |
|---|---|---|
| `StockVesting.sol` written (frozen thereafter) | ✅ | `contracts/contracts/StockVesting.sol` |
| Compiles with solc 0.8.24 (cancun) | ✅ | `npx hardhat compile` — "Compiled 2 Solidity files successfully" |
| Test suite (vesting math, release, revoke, gift, multiplier invariance, memo, non-18 decimals) | ✅ | `npx hardhat test` — **11 passing** |
| ABI exported for frontend | ✅ | `contracts/abi/StockVesting.json` (13 entries) |
| Deploy script | ✅ | `contracts/scripts/deploy.js` |
| **Deployed to Base mainnet (8453)** | ⛔ | needs funded deployer key — owner runs `npm run deploy:base` |
| **Basescan source verification** | ⛔ | after deploy: `npm run verify -- <addr>` |

## Frontend (`web/`)
Next.js 16.3.4 (Turbopack) · React 19 · wagmi 3.7 · viem 2.56 · @tanstack/react-query 5.

| Item | State | Evidence |
|---|---|---|
| App scaffold (Next.js + wagmi/viem) | ✅ | `web/` builds; wagmi config Base-only (`web/lib/wagmi.ts`) |
| Centralized B20 conversion helper (`rawToUi`/`uiToRaw`) | ✅ | `web/lib/b20.ts` — uses the live token surface `toScaledBalance`/`toRawBalance` first, with forward-compatible UI-name fallback; never `raw=ui` |
| Shared memo encoder/decoder (bytes32, UTF-8 validated) | ✅ | `web/lib/memo.ts` + **6 unit tests pass** (`node --test lib/memo.test.ts`) |
| Amount parse/format (tabular, small-fraction precision) | ✅ | `web/lib/format.ts` + **6 unit tests pass** |
| Recipient resolution (Basename + EVM address) | ✅ | `web/lib/recipient.ts` — unresolved names blocked; resolver env-gated (not guessed) |
| Eligibility gate (non-US, not KYC, re-openable) | ✅ | `web/components/Eligibility.tsx` |
| Pay flow (approve→createGrant, event-sourced id) | ✅ | `web/components/GrantComposer.tsx` (mode="pay") |
| Gift flow (revocable=false, all-or-nothing) | ✅ | `web/components/GrantComposer.tsx` (mode="gift") |
| Tip flow (native `transferWithMemo`, no escrow approval) | ✅ | `web/components/TipComposer.tsx` |
| Mobile claim page `/claim/[id]` (hero ticks off vesting curve) | ✅ | `web/app/claim/[id]/page.tsx` + `web/components/useGrant.ts` |
| Wrong-network protection (Switch to Base) | ✅ | `web/components/AppShell.tsx` NetworkNotice |
| Privy sponsored transaction rail (Base mainnet) | ▫️ | Deferred; current production path uses normal wallet gas |
| Honest unconfigured state (no fake data before deploy) | ✅ | verified in-browser: `/pay` shows "Not configured yet" |
| typecheck / lint / build green | ✅ | `tsc --noEmit` exit 0 · `eslint` exit 0 · `next build` ✓ 5 routes |
| Visual check (mobile) | ✅ | home + pay + review + claim screenshotted at 375px; teal/serif design renders |
| **End-to-end grant→claim→tip against a live chain** | ✅ | Local Hardhat pass — see Task A below |

## Task B — real B20 surface & official assets (verified on Base mainnet 2026-09-09)
Verified directly against Base mainnet (chainId 8453) by on-chain `eth_call`, not
by trusting docs or a page scrape.

| Item | State | Evidence |
|---|---|---|
| Real B20 read surface confirmed | ✅ | Base B20 spec + live tokens expose `multiplier`, `scaledBalanceOf`, `toScaledBalance(raw)`, `toRawBalance(scaled)`. `toUIAmount`/`fromUIAmount` **do not exist**. |
| Frontend helper realigned to real surface | ✅ | `web/lib/b20.ts` now prefers `toScaledBalance`/`toRawBalance` (UI-named fns kept only as forward-compat fallback) |
| MockB20 mirrors real surface exactly | ✅ | `contracts/contracts/test/MockB20.sol` — dropped `toUIAmount/fromUIAmount/balanceOfUI/uiMultiplier`; added `transferFromWithMemo`; 11/11 tests still pass |
| Memo transfer fn confirmed | ✅ | `transferWithMemo(address,uint256,bytes32)` exists on the real token; Tip binds to it |
| Official AAPLc address | ✅ | `0xb200000000000000000000C2e324d24d7eEcd1fb` — symbol `AAPLc`, "Apple Inc.", **decimals 8**, multiplier 1e18, `toScaledBalance` responds |
| Official NVDAc address | ✅ | `0xb20000000000000000000078ee7ce2fE4908108C` — symbol `NVDAc`, "NVIDIA Corporation", **decimals 8**, multiplier 1e18 |
| Decimals read dynamically (not hardcoded 18) | ✅ | real tokens are **8 decimals**; `getDecimals()` reads per-token |
| Allowlist records verified addresses | ✅ | `web/lib/tokens.ts` defaults to the two verified addresses (env can override for local) |

> Finding: the earlier build appendix said to prefer `toUIAmount`/`fromUIAmount`.
> That was wrong — those selectors are absent on the real token. `StockVesting.sol`
> was already correct (`toScaledBalance`). Everything is now aligned to the real surface.

## Task A — local end-to-end proof (Hardhat, chainId 31337 — NOT mainnet)
Exercised every flow through the real UI against locally-deployed `StockVesting` +
`MockB20` (decimals 8, real B20 surface). Dev-only, behind `NEXT_PUBLIC_ENABLE_LOCAL`
(off by default). Tx hashes below are **local-chain** hashes, not Base mainnet.

| Flow | Result | Local tx |
|---|---|---|
| Pay: approve + createGrant, id `#0` decoded from `GrantCreated` (not guessed) | ✅ | approve `0x87a5…07fb6`, create `0xc993…f6d8a7` |
| Claim: `release()` — recipient AAPLc balance went 0 → **0.01** on-chain; Released updated | ✅ | `0x8d1d…4d51e` |
| Tip: native `transferWithMemo` — recipient → **0.03**; `MemoTransfer` event emitted | ✅ | `0x5e41…f210e` |
| Eligibility gate blocks action until acknowledged | ✅ | intercepted first Review click |
| Revoke UI shown for employer (revocable, not revoked) | ✅ | claim page for connected grantor |
| Bug found & fixed | ✅ | float tick → `BigInt` RangeError in `useGrant.vestedUiAt`; now floors before BigInt |

To reproduce: `npx hardhat node`, then `npx hardhat run scripts/deploy-local.js
--network localhost` (writes `web/.env.local`), then `npm --prefix web run dev`.

## Hosting — VPS (Docker + Caddy)
Deployment setup for a VPS: Next.js standalone in Docker behind Caddy (automatic
HTTPS). Runbook: `docs/VPS.md`.

| Item | State | Evidence |
|---|---|---|
| Next standalone output | ✅ | `web/next.config.ts` `output: "standalone"`; build emits `.next/standalone/server.js` |
| Standalone server runs like the container | ✅ | ran `node server.js` locally — `/`, `/pay`, `/claim/0` all 200 |
| Multi-stage Dockerfile | ✅ | `web/Dockerfile` (deps → build → minimal runner, non-root) |
| Compose + Caddy auto-HTTPS | ✅ | `deploy/docker-compose.yml`, `deploy/Caddyfile` (domain via `OWNPAY_DOMAIN`) |
| Public-only config (no secrets on box) | ✅ | `deploy/.env.example` — only `NEXT_PUBLIC_*` + hostname |
| Docker image built on the VPS | ⛔ | Docker unavailable in this session; first `docker compose up --build` runs on the VPS |

## Owner-only actions (cannot be automated in this session)
These involve real funds / real signatures and must be performed by the project
owner with their own wallet. Turnkey runbook: `docs/DEPLOY.md`.
1. Fund a deployer address with a little ETH on Base and run `npm run deploy:base`.
2. Set `NEXT_PUBLIC_STOCK_VESTING_ADDRESS` and verify the contract on Basescan.
3. Create one real demo grant + claim + tip, saving the mainnet tx hashes.
   (Official token addresses are already verified and configured — step done.)
