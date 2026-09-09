require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// NOTE: secrets come from environment only. Never hardcode a private key here.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    // Base mainnet — chainId 8453. Requires DEPLOYER_PRIVATE_KEY in .env to deploy.
    base: {
      url: BASE_RPC_URL,
      chainId: 8453,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: BASESCAN_API_KEY,
  },
};
