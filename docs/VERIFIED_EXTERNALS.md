# Verified external integrations — OwnPay Robinhood testnet

Checked 2026-10-03. Only chain **46630** is the hackathon deployment target.
Existing Base functionality is preserved separately; Arbitrum One/Sepolia are not
used as substitutes. Arbitrum deployment is a post-submission roadmap item.

| Integration | Official evidence | Verification / current status |
| --- | --- | --- |
| Network | [Robinhood network configuration](https://docs.robinhood.com/chain/add-network-to-wallet/) | `eth_chainId` = 46630 at `https://rpc.testnet.chain.robinhood.com`. Testnet explorer `https://explorer.testnet.chain.robinhood.com`. |
| Testnet USDG | [Paxos testnet deployments](https://docs.paxos.com/guides/stablecoin/usdg/testnet) | `0x7E955252E15c84f5768B83c41a71F9eba181802F`; bytecode present; `symbol()` = USDG; `decimals()` = 6. See `evidence/robinhood-network.json` for code hash and funding check. Paxos page was indexed but direct retrieval returned 403; RPC independently confirmed metadata/code, not issuer authenticity. |
| Stock Token registry | [Official API schema](https://docs.robinhood.com/chain/stock-token-apis/), [official assets endpoint](https://api.robinhood.com/rhj/assets) | Live endpoint returned 194 assets and **zero** deployments with chainId 46630. Mainnet addresses are not copied into testnet. No real Stock Token purchase is enabled. |
| Stock Token semantics | [Official overview](https://docs.robinhood.com/chain/stock-tokens/), [terms](https://docs.robinhood.com/chain/terms-of-service/) | Stock Tokens are debt securities with exposure, not direct equity ownership. Use approved terminology. Testnet units have no value. |
| Faucet | [Robinhood testnet support](https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/) | `https://faucet.testnet.chain.robinhood.com`; automated retrieval hit a security checkpoint (429), web retrieval 403. No faucet claim fabricated or bypass attempted. |
| ZeroDev chain support | [Current supported networks](https://docs.zerodev.app/api-and-toolings/faqs/chains) | Explicitly lists Robinhood Testnet 46630. |
| Kernel / sponsorship SDK | [Robinhood AA guide](https://docs.robinhood.com/chain/account-abstraction/), installed official npm packages | `@zerodev/sdk` 5.5.10 and `@zerodev/ecdsa-validator` 5.4.9 verified through npm metadata and installed type definitions. Guide examples target mainnet; our adapter fixes chain to 46630 and checks EntryPoint/validator/factory bytecode. See `evidence/robinhood-kernel.json`. No project endpoint/gas policy was supplied; sponsorship is disabled, not claimed live. |
| Embedded signer | Existing installed Privy SDK | Existing Base email onboarding preserved. Robinhood added as supported chain. Email mode never substitutes injected/external wallet. New testnet login requires interactive verification; not claimed completed by static typecheck. |
| Compliance | No external screening/KYC provider configured | Explicit local test-policy administrator with expiry and block flag. Fails closed on unknown/expired payer/recipient for router payments. NOT regulatory certification, KYC or sanctions screening. Direct account deposits have unknown payer provenance; receiver eligibility only applies at allocation. |
| Metadata | Browser Web Crypto AES-GCM | Encrypted note ciphertext/key stored locally; only randomized ciphertext commitment goes onchain. Addresses/amounts are PUBLIC. Keys are accessible to same-origin JS; not confidential against XSS/device compromise. No privacy-protocol claims. |

## Explicit demo components

`DemoOwnershipAdapter` creates `DEMO-OWN` units at a fixed demo conversion of one
unit per test USDG. Test USDG ownership allocations transfer to the demo treasury
(the deployment signer). This is an observable **test implementation**, not a DEX,
market price, backed asset, Robinhood Stock Token, investment or redemption promise.
Never send real funds. The default rule uses withdrawable USDG reserve instead.

`OwnReceiveAccount` is our purpose-limited smart contract receive account, not a
Kernel/ERC-4337 account. `executeSigned` is our custom sponsored EIP-712 relay,
not a third-party paymaster. Optional ZeroDev Kernel mode is separately labeled.

## Live deployment gate

No contract addresses or demo transaction hashes are asserted until deployment
and receipt verification succeeds. The deployment signer was initially checked as
having **0 testnet ETH and 0 testnet USDG**. Subsequent faucet funding supplied
0.01 test ETH, test stock balances, and 100 canonical test USDG. A normal official
Paxos faucet API request succeeded using the public client format and existing
per-wallet limits; see `evidence/robinhood-usdg-funding.json`.

OwnRules and the explicitly labeled demo contracts are now deployed; verified
addresses are in `../contracts/deployments/robinhood-testnet.json`. Real wallet-paid
demo receipts are in `evidence/robinhood-demo.json`. Funding no longer blocks this
demo, but gas sponsorship is still not configured or proven.

The external SwapRouter `0x2953A82d44fDACfa7a49BfFF24f7Cc5879F10805` has deployed
bytecode and an explorer ABI for stock-to-USDG functions. Its registry returns the
canonical USDG address, but its source is only partially verified and all five
faucet-stock quotes reverted. The registry's TSLA revert decodes as `StalePrice`.
No approval or swap was sent through this router; it is not an OwnPay dependency.
