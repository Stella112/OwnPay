import { AppShell } from '@/components/AppShell';
import { RobinhoodSessionProvider } from '@/components/robinhood/session';
import { RhAccountBar, RhSidebar } from '@/components/robinhood/RhChrome';

export const metadata = {
  title: 'OwnPay — Robinhood Chain Testnet',
  description: 'Money arrives. OwnPay knows what should happen next. Programmable USDG payments, stock grants and automation on Robinhood Chain testnet.',
};

// The session (sign-in, smart account, status, history) lives in this layout so it
// survives client-side navigation between the Robinhood pages.
export default function RobinhoodLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell variant="robinhood-testnet">
      <RobinhoodSessionProvider>
        <div className="dashboard-frame">
          <RhSidebar />
          <main className="dashboard-main"><RhAccountBar />{children}</main>
        </div>
      </RobinhoodSessionProvider>
    </AppShell>
  );
}
