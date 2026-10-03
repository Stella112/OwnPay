// Deploy the existing, tested StockVesting escrow to Robinhood Chain Testnet (46630)
// for Pay / Gift / Tip with the faucet-issued testnet stock tokens.
//   npx hardhat run scripts/deploy-stock-vesting-robinhood.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Verified over RPC 2026-10-03 (docs/VERIFIED_EXTERNALS.md). No value; faucet-issued.
const STOCKS = {
  TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d",
  AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
  PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
};

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 46630n) throw new Error(`Expected chain 46630, got ${chainId} (${network.name})`);
  const out = path.join(__dirname, "..", "deployments", "robinhood-stock-vesting.json");
  if (fs.existsSync(out)) throw new Error(`Already deployed: ${out}`);

  for (const [sym, addr] of Object.entries(STOCKS)) {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") throw new Error(`${sym} has no code`);
  }

  const [deployer] = await ethers.getSigners();
  const Vesting = await ethers.getContractFactory("StockVesting");
  const vesting = await Vesting.deploy();
  const tx = vesting.deploymentTransaction();
  const receipt = await tx.wait();
  const address = await vesting.getAddress();
  if ((await ethers.provider.getCode(address)) === "0x") throw new Error("No code at deployed address");

  const manifest = {
    chainId: 46630,
    stockVesting: address,
    deployTx: tx.hash,
    deploymentBlock: receipt.blockNumber,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    stockTokens: STOCKS,
    disclaimer: "Faucet-issued Robinhood Chain testnet stock tokens; no monetary value; not registry-listed.",
  };
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
