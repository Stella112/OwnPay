import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base, hardhat } from "wagmi/chains";
import { injected, coinbaseWallet, mock } from "wagmi/connectors";

/**
 * wagmi config — Base mainnet (chainId 8453) in production.
 *
 * DEV-ONLY local mode: when NEXT_PUBLIC_ENABLE_LOCAL === "true" the app targets a
 * local Hardhat node (chainId 31337) using the `mock` connector bound to Hardhat's
 * first unlocked account, so end-to-end flows can be exercised without a real
 * wallet or real funds. This flag is OFF by default and MUST stay off in
 * production — with it off the app behaves exactly as before.
 */
const LOCAL = process.env.NEXT_PUBLIC_ENABLE_LOCAL === "true";

// Hardhat's well-known first account (unlocked on the local node; not a secret).
const HARDHAT_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const localRpc = process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545";

export const BASE_CHAIN_ID = base.id; // 8453
/** The network the app expects to transact on (Base in prod, Hardhat in local mode). */
export const EXPECTED_CHAIN = LOCAL ? hardhat : base;
export const EXPECTED_CHAIN_ID = EXPECTED_CHAIN.id;

export const wagmiConfig = LOCAL
  ? createConfig({
      chains: [hardhat],
      connectors: [mock({ accounts: [HARDHAT_ACCOUNT] })],
      transports: { [hardhat.id]: http(localRpc) },
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
    })
  : createConfig({
      chains: [base],
      connectors: [injected(), coinbaseWallet({ appName: "OwnPay" })],
      transports: { [base.id]: http(rpcUrl) },
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
    });

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
