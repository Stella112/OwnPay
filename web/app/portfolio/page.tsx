import { AppShell } from "@/components/AppShell";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PortfolioSession } from "@/components/PortfolioSession";

export default function PortfolioPage() {
  return (
    <AppShell>
      <div className="dashboard-frame">
        <DashboardSidebar active="portfolio" />
        <main className="dashboard-main portfolio-page-main">
          <PortfolioSession />
        </main>
      </div>
    </AppShell>
  );
}
