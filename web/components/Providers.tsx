"use client";

import { WagmiProvider } from "wagmi";
import { useSetActiveWallet, WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { getEmbeddedConnectedWallet, PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { base } from "wagmi/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { EligibilityProvider } from "@/components/Eligibility";
import { robinhoodTestnet } from '@/lib/robinhood';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      }),
  );

  const content = <EligibilityProvider>{children}</EligibilityProvider>;
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}>{content}</QueryClientProvider></WagmiProvider>;
  }
  return <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID} config={{ supportedChains: [base, robinhoodTestnet], defaultChain: base, embeddedWallets: { ethereum: { createOnLogin: "all-users" } } }}><QueryClientProvider client={queryClient}><PrivyWagmiProvider config={wagmiConfig}><PrivyWalletSync>{content}</PrivyWalletSync></PrivyWagmiProvider></QueryClientProvider></PrivyProvider>;
}

function PrivyWalletSync({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const embeddedWallet = useMemo(() => getEmbeddedConnectedWallet(wallets), [wallets]);

  useEffect(() => {
    if (!ready || !authenticated || !embeddedWallet) return;
    void setActiveWallet(embeddedWallet).catch(() => undefined);
  }, [ready, authenticated, embeddedWallet, setActiveWallet]);

  return children;
}
