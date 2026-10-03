import { RobinhoodWorkbench } from '@/components/RobinhoodWorkbench';
import { AppShell } from '@/components/AppShell';
import { DashboardSidebar } from '@/components/DashboardSidebar';
export const metadata = { title: 'OwnPay OwnRules — Robinhood Chain Testnet', description: 'Money arrives. OwnPay knows what should happen next. Testnet-only programmable USDG payments.' };
export default function Page() {
  return <AppShell variant="robinhood-testnet"><div className="dashboard-frame"><DashboardSidebar active="robinhood" showRobinhood /><main className="dashboard-main"><RobinhoodWorkbench /></main></div></AppShell>;
}
