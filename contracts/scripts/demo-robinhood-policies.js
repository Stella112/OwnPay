// OwnRules v2 on Robinhood Chain Testnet (46630): prove recipient-programmed
// compliance with real transactions and two distinct wallets.
//   recipient = deployer (owns the rule + policy); payer = fresh funded test wallet.
// Negative cases run as eth_call from the payer AFTER its USDG approval, so a revert
// can only come from the recipient's policy, not from missing funds/allowance.
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/robinhood-testnet.json"), "utf8"));
const u = (n) => ethers.parseUnits(String(n), 6);
const NOTE = ethers.keccak256(ethers.toUtf8Bytes("invoice #42"));

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 46630n) throw new Error("wrong chain");
  const [recipient] = await ethers.getSigners();
  const payer = ethers.Wallet.createRandom().connect(ethers.provider);
  const router = await ethers.getContractAt("OwnRules", m.ownRules);
  const usdg = new ethers.Contract(USDG, ["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function transfer(address,uint256) returns(bool)"], recipient);
  const ev = { chainId: 46630, ownRules: m.ownRules, recipient: recipient.address, payer: payer.address, steps: [], checks: {} };
  const send = async (label, p) => { const r = await (await p).wait(); if (r.status !== 1) throw new Error(`${label} reverted`); ev.steps.push({ label, tx: r.hash, explorer: `${EXPLORER}/tx/${r.hash}` }); console.log("✓", label, r.hash); return r; };
  // This RPC reports reverts as raw Error(string) data (code 3), not ethers' parsed reason.
  const reason = async (fn) => { try { await fn(); return null; } catch (e) {
    if (typeof e.data === 'string' && e.data.startsWith('0x08c379a0')) return ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + e.data.slice(10))[0];
    return e.reason || (e.message || '').replace(/^execution reverted: /, '').split('\n')[0]; } };
  const payAs = router.connect(payer);

  // Fund payer (test ETH for gas + test USDG) and set up the recipient's rule + receive account.
  await send("fund payer with test ETH", recipient.sendTransaction({ to: payer.address, value: ethers.parseEther("0.0005") }));
  await send("fund payer with 6 test USDG", usdg.transfer(payer.address, u(6)));
  await send("payer approves OwnRules", usdg.connect(payer).approve(m.ownRules, u(6)));
  if ((await router.accounts(recipient.address)) === ethers.ZeroAddress) await send("recipient creates receive account", router.createAccount());
  await send("recipient saves 70/10/20 rule", router.saveRule(1000, 2000, u(100), u(500), ethers.ZeroAddress, 0, true));

  // 1. No admin: an unknown payer can pay an open recipient.
  ev.checks.noAdminFunctionExists = typeof router.setCompliance === "undefined";
  const r1 = await send("open policy: unknown payer pays 1 USDG (no admin approval)", payAs.pay(recipient.address, u(1), NOTE));
  const rec = r1.logs.map((l) => { try { return router.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "PaymentReceipt");
  ev.checks.openPaymentSplit = rec && rec.args.spendable === u(0.7) && rec.args.saved === u(0.1) && rec.args.ownership === u(0.2);

  // 2. Blocklist.
  await send("recipient blocks payer", router.setSender(payer.address, 2));
  ev.checks.blockedSenderRejected = (await reason(() => payAs.pay.staticCall(recipient.address, u(1), NOTE))) === "policy: sender blocked";

  // 3. Allowlist-only.
  await send("recipient unblocks payer + turns on allowlist-only", router.setSender(payer.address, 0));
  await send("recipient sets allowlist-only", router.setPolicy(true, false, 0));
  ev.checks.notAllowlistedRejected = (await reason(() => payAs.pay.staticCall(recipient.address, u(1), NOTE))) === "policy: sender not allowlisted";
  await send("recipient allowlists payer", router.setSender(payer.address, 1));
  await send("allowlisted payer pays 1 USDG", payAs.pay(recipient.address, u(1), NOTE));
  ev.checks.allowlistedAccepted = true;

  // 4. Direct deposits fail closed under allowlist-only (sender unverifiable).
  const account = await router.accounts(recipient.address);
  await send("payer sends 1 USDG straight to recipient's receive account", usdg.connect(payer).transfer(account, u(1)));
  ev.checks.directDepositFailsClosed = (await reason(() => router.processIncoming.staticCall(recipient.address, u(1), ethers.ZeroHash))) === "policy: sender unverifiable";
  const acct = await ethers.getContractAt("OwnReceiveAccount", account);
  await send("recipient recovers the unprocessed deposit", acct.recover(USDG, u(1)));

  // 5. Required memo.
  await send("recipient requires a payment note", router.setPolicy(false, true, 0));
  ev.checks.missingMemoRejected = (await reason(() => payAs.pay.staticCall(recipient.address, u(1), ethers.ZeroHash))) === "policy: memo required";

  // 6. Per-sender daily cap.
  await send("recipient sets per-sender daily cap of 1.5 USDG", router.setPolicy(false, false, u(1.5)));
  await send("payer pays 1 USDG (within cap)", payAs.pay(recipient.address, u(1), NOTE));
  ev.checks.senderCapRejected = (await reason(() => payAs.pay.staticCall(recipient.address, u(1), NOTE))) === "policy: sender daily cap";

  // Reset to an open policy for the live demo.
  await send("recipient resets to open policy", router.setPolicy(false, false, 0));
  ev.allChecksPassed = Object.values(ev.checks).every(Boolean);
  ev.checkedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "../../docs/evidence/robinhood-policies.json"), JSON.stringify(ev, null, 2) + "\n");
  console.log(JSON.stringify({ checks: ev.checks, allChecksPassed: ev.allChecksPassed }, null, 2));
  if (!ev.allChecksPassed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
