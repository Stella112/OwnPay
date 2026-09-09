"use client";

import { createContext, useContext, useMemo } from "react";
import { useSendTransaction as usePrivySendTransaction } from "@privy-io/react-auth";
import type { Abi, Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { useWriteContract } from "wagmi";
import { BASE_CHAIN_ID } from "@/lib/wagmi";

type ContractRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

type OwnPayTransactionContextValue = {
  writeContractAsync: (request: ContractRequest) => Promise<Hex>;
  sponsored: boolean;
};

const OwnPayTransactionContext = createContext<OwnPayTransactionContextValue | null>(null);

/**
 * Privy-backed transaction rail. Every embedded-wallet write is explicitly
 * requested as sponsored. Sponsorship is fail-closed: if the Privy policy is
 * missing or exhausted, we show the error instead of silently resubmitting a
 * user-paid transaction.
 */
export function PrivyOwnPayTransactionProvider({ children }: { children: React.ReactNode }) {
  const { sendTransaction } = usePrivySendTransaction();

  const value = useMemo<OwnPayTransactionContextValue>(() => ({
    sponsored: true,
    writeContractAsync: async ({ address, abi, functionName, args }) => {
      const data = encodeFunctionData({
        abi,
        functionName,
        args: args as readonly unknown[],
      });
      try {
        const result = await sendTransaction(
          { to: address, data, chainId: BASE_CHAIN_ID },
          { sponsor: true },
        );
        return result.hash;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/sponsor|gas|paymaster|policy|fund/i.test(message)) {
          throw new Error("Gas sponsorship is not available for this transaction yet. Enable and fund the Base mainnet sponsorship policy in Privy, then try again.");
        }
        throw error;
      }
    },
  }), [sendTransaction]);

  return <OwnPayTransactionContext.Provider value={value}>{children}</OwnPayTransactionContext.Provider>;
}

/** Local/dev and non-Privy fallback rail. */
export function WagmiOwnPayTransactionProvider({ children }: { children: React.ReactNode }) {
  const { writeContractAsync } = useWriteContract();
  const value = useMemo<OwnPayTransactionContextValue>(() => ({
    sponsored: false,
    writeContractAsync: (request) => writeContractAsync(request as never),
  }), [writeContractAsync]);
  return <OwnPayTransactionContext.Provider value={value}>{children}</OwnPayTransactionContext.Provider>;
}

export function useOwnPayTransaction() {
  const value = useContext(OwnPayTransactionContext);
  if (!value) throw new Error("OwnPay transaction provider is missing.");
  return value;
}
