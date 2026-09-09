const { ethers, network } = require("hardhat");

/**
 * Deploy StockVesting to the configured network (Base mainnet, chainId 8453).
 *
 * Usage:
 *   1. Put DEPLOYER_PRIVATE_KEY and BASE_RPC_URL in contracts/.env
 *   2. npm run deploy:base
 *   3. Copy the printed address into web/.env.local as NEXT_PUBLIC_STOCK_VESTING_ADDRESS
 *   4. Verify: npm run verify -- <address>
 *
 * This script only DEPLOYS the escrow contract. It never handles user funds and
 * never creates grants — those are user-signed actions in the app.
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId ${net.chainId})`);

  if (network.name === "base" && net.chainId !== 8453n) {
    throw new Error(`Expected Base mainnet (8453) but got chainId ${net.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in .env");
  }
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(bal)} ETH`);

  const Vesting = await ethers.getContractFactory("StockVesting");
  const vesting = await Vesting.deploy();
  console.log(`Deploy tx: ${vesting.deploymentTransaction()?.hash}`);
  await vesting.waitForDeployment();

  const address = await vesting.getAddress();
  console.log("");
  console.log("StockVesting deployed:");
  console.log(`  address: ${address}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  NEXT_PUBLIC_STOCK_VESTING_ADDRESS=${address}`);
  console.log(`  npm run verify -- ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
