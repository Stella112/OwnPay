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
records an active authority after the authenticated identity token confirms a
delegated Privy embedded wallet. The worker checks that record before planning
an action and blocks paused, revoked, or unconfigured authority.

This is an authority gate, not execution permission. The worker now has a
strict USDC→B20 route interface and records `AUTOMATION_UNAVAILABLE` until a
venue/router, quote validation, and server-side signing authority have all
been independently verified and configured. It cannot spend USDC in the
current configuration.

## Explicitly not implemented yet

- a live verified Base USDC→B20 venue/router and quote adapter (M6)
- automatic execution or arbitrary calldata
- ERC-8004 identity (M7)

The worker contains no fallback route and cannot spend USDC in its current
state. Do not change it to execute until M5 and M6 have independently passed
their security and verification gates.
