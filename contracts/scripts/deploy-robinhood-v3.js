// Deploy OwnRules v3 (portfolio ownership + market-hours queue) and the OwnPay
// testnet stock desk to Robinhood Chain Testnet (46630), list the five faucet stocks,
// and seed the desk with the deployer's faucet stock inventory.
//   npx hardhat run scripts/deploy-robinhood-v3.js --network robinhoodTestnet
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const STOCKS = {
  TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d",
  AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
  PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
};
const RELAYER = process.env.ROBINHOOD_PRICE_RELAYER || "0xe281AaECD81ae50179Bc0026eC253aD2172D7898"; // VPS agent key
const MAX_AGE = 1800;  // a market quote is usable for 30 minutes
const SPREAD = 30;     // 0.30%
const SEED = ethers.parseUnits("3", 18); // per stock, capped by deployer balance

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 46630n) throw new Error(`wrong chain ${chainId}`);
  const out = path.join(__dirname, "..", "deployments", "robinhood-testnet.json");
  const prev = JSON.parse(fs.readFileSync(out, "utf8"));
  if (prev.version === 3) throw new Error("v3 already deployed");
  const [deployer] = await ethers.getSigners();
  const txs = {};
  const wait = async (label, p) => { const r = await (await p).wait(); if (r.status !== 1) throw new Error(label); txs[label] = r.hash; console.log("✓", label, r.hash); return r; };

  const Desk = await ethers.getContractFactory("OwnPayStockDesk");
  const desk = await Desk.deploy(USDG, RELAYER, MAX_AGE, SPREAD); await desk.waitForDeployment();
  txs.desk = desk.deploymentTransaction().hash; console.log("✓ desk", await desk.getAddress());
  for (const [sym, a] of Object.entries(STOCKS)) await wait(`list ${sym}`, desk.list(a, true));

  const Rules = await ethers.getContractFactory("OwnRules");
  const rules = await Rules.deploy(USDG, await desk.getAddress()); const rr = await rules.deploymentTransaction().wait();
  txs.ownRules = rr.hash; console.log("✓ OwnRules v3", await rules.getAddress());

  const erc = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
  const seeded = {};
  for (const [sym, a] of Object.entries(STOCKS)) {
    const t = new ethers.Contract(a, erc, deployer);
    const bal = await t.balanceOf(deployer.address);
    const amt = bal > SEED ? SEED : bal;
    if (amt > 0n) await wait(`seed ${sym}`, t.transfer(await desk.getAddress(), amt));
    seeded[sym] = ethers.formatUnits(amt, 18);
  }

  fs.writeFileSync(path.join(__dirname, "..", "deployments", "robinhood-testnet.v2.json"), JSON.stringify(prev, null, 2) + "\n");
  const manifest = {
    version: 3, chainId: 46630, usdg: USDG,
    ownRules: await rules.getAddress(), vesting: await rules.vesting(), stockDesk: await desk.getAddress(),
    deploymentBlock: rr.blockNumber, deployer: deployer.address, deployedAt: new Date().toISOString(),
    desk: { relayer: RELAYER, maxAgeSeconds: MAX_AGE, spreadBps: SPREAD, listed: STOCKS, seededShares: seeded },
    transactions: txs,
    disclaimer: "Testnet only. The desk sells faucet-issued stock tokens (no monetary value) at relayed public market prices; not a DEX or investment venue.",
  };
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
