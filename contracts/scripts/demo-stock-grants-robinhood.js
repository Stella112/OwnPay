// Real Robinhood Chain Testnet (46630) demo of stock-token Pay / revoke / Gift / Tip
// through the deployed StockVesting escrow. Every assertion reads chain state.
//   npx hardhat run scripts/demo-stock-grants-robinhood.js --network robinhoodTestnet
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "robinhood-stock-vesting.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memo = (s) => ethers.encodeBytes32String(s);
const ERC20 = ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 46630n) throw new Error("wrong chain");
  const [grantor] = await ethers.getSigners();
  const recipient = ethers.Wallet.createRandom().address; // fresh demo recipient (testnet, no value)
  const v = await ethers.getContractAt("StockVesting", m.stockVesting);
  const tok = (s) => ethers.getContractAt(ERC20, m.stockTokens[s]);
  const amt = ethers.parseUnits("0.1", 18); // verified: all five tokens use 18 decimals
  const ev = { chainId: 46630, stockVesting: m.stockVesting, grantor: grantor.address, recipient, steps: [], checks: {} };
  const send = async (label, p) => { const tx = await p; const r = await tx.wait(); if (r.status !== 1) throw new Error(`${label} reverted`); ev.steps.push({ label, tx: r.hash, explorer: `${EXPLORER}/tx/${r.hash}` }); console.log("✓", label, r.hash); return r; };
  const idOf = (r) => { for (const l of r.logs) { try { const p = v.interface.parseLog(l); if (p?.name === "GrantCreated") return p.args.id; } catch {} } throw new Error("no GrantCreated"); };
  const now = async () => Number((await ethers.provider.getBlock("latest")).timestamp);
  const reverts = async (fn) => { try { await fn(); return false; } catch { return true; } };

  for (const s of ["TSLA", "AMD", "AMZN", "NFLX"]) {
    const bal = await (await tok(s)).balanceOf(grantor.address);
    if (bal < amt) throw new Error(`grantor lacks ${s}`);
    await send(`approve ${s}`, (await tok(s)).approve(m.stockVesting, amt));
  }

  const t0 = await now();
  // Pay: revocable, 40s cliff, 60s linear vesting. Cliff checked immediately after creation.
  const payId = idOf(await send("Pay TSLA (createGrant, revocable)", v.createGrant(m.stockTokens.TSLA, recipient, amt, t0, t0 + 40, 60, true, memo("2026 contributor"))));
  ev.checks.payLockedBeforeCliff = (await v.releasableRaw(payId)) === 0n;
  // Pay to revoke: no cliff, 120s vesting.
  const revId = idOf(await send("Pay AMD (createGrant, revocable)", v.createGrant(m.stockTokens.AMD, recipient, amt, t0, t0, 120, true, memo("vesting bonus"))));
  // Gift: irrevocable, all-or-nothing at unlock (cliff == end).
  const giftId = idOf(await send("Gift AMZN (createGrant, irrevocable)", v.createGrant(m.stockTokens.AMZN, recipient, amt, t0, t0 + 45, 45, false, memo("Happy birthday"))));
  ev.grants = { pay: String(payId), revocable: String(revId), gift: String(giftId) };

  ev.checks.giftLockedBeforeUnlock = (await v.releasableRaw(giftId)) === 0n;
  ev.checks.giftRevokeRejected = await reverts(() => v.revoke.staticCall(giftId));

  // Tip: these tokens lack transferWithMemo, so use the escrow's tipWithMemo.
  const tipAmt = ethers.parseUnits("0.05", 18);
  await send("approve NFLX (tip)", (await tok("NFLX")).approve(m.stockVesting, tipAmt));
  const tipR = await send("Tip NFLX (tipWithMemo)", v.tipWithMemo(m.stockTokens.NFLX, recipient, tipAmt, memo("thanks!")));
  ev.checks.tipMemoEvent = tipR.logs.some((l) => { try { return v.interface.parseLog(l)?.name === "MemoTransfer"; } catch { return false; } });
  ev.checks.tipDelivered = (await (await tok("NFLX")).balanceOf(recipient)) === tipAmt;

  // Wait past every unlock/end (by chain time, not wall time).
  while ((await now()) < t0 + 65) await sleep(3000);

  await send("Claim Pay TSLA (release)", v.release(payId));
  ev.checks.payFullyClaimed = (await (await tok("TSLA")).balanceOf(recipient)) === amt;
  ev.checks.payDoubleReleaseRejected = await reverts(() => v.release.staticCall(payId));

  const amdBefore = await (await tok("AMD")).balanceOf(grantor.address);
  const revR = await send("Revoke AMD (unvested returns to grantor)", v.revoke(revId));
  const refunded = (await (await tok("AMD")).balanceOf(grantor.address)) - amdBefore;
  const vestedKept = (await v.grants(revId)).total; // capped to vested at revoke
  await send("Claim revoked grant's vested AMD (release)", v.release(revId));
  const amdRecipient = await (await tok("AMD")).balanceOf(recipient);
  ev.checks.revokeSplitsCorrectly = refunded > 0n && refunded < amt && refunded + vestedKept === amt && amdRecipient === vestedKept;
  ev.checks.secondRevokeRejected = await reverts(() => v.revoke.staticCall(revId));
  ev.revoke = { refundedToGrantor: ethers.formatUnits(refunded, 18), vestedKeptByRecipient: ethers.formatUnits(vestedKept, 18), block: revR.blockNumber };

  await send("Claim Gift AMZN (release)", v.release(giftId));
  ev.checks.giftFullyClaimed = (await (await tok("AMZN")).balanceOf(recipient)) === amt;

  ev.allChecksPassed = Object.values(ev.checks).every(Boolean);
  ev.checkedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "..", "..", "docs", "evidence", "robinhood-stock-grants.json"), JSON.stringify(ev, null, 2) + "\n");
  console.log(JSON.stringify({ checks: ev.checks, revoke: ev.revoke, allChecksPassed: ev.allChecksPassed }, null, 2));
  if (!ev.allChecksPassed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
