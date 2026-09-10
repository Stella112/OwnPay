import { AppShell } from "@/components/AppShell";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { AgentAuthorityCard } from "@/components/AgentAuthorityCard";
import { OwnershipRulesPanel } from "@/components/OwnershipRulesPanel";

export default function AutomationPage() {
  return <AppShell><div className="dashboard-frame"><DashboardSidebar active="automation" /><main className="dashboard-main"><div className="page-intro"><p className="eyebrow">Programmable ownership</p><h1>Your rules, your control.</h1><p className="soft">Save an ownership rule, then separately choose whether the agent may act within those limits.</p></div><AgentAuthorityCard /><OwnershipRulesPanel /></main></div></AppShell>;
}
