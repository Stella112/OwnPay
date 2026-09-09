"use client";

import { WagmiProvider } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { EligibilityProvider } from "@/components/Eligibility";

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
  return <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID} config={{ embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } } }}><QueryClientProvider client={queryClient}><PrivyWagmiProvider config={wagmiConfig}>{content}</PrivyWagmiProvider></QueryClientProvider></PrivyProvider>;
}
