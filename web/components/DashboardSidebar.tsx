import Link from "next/link";
import { OwnPayIcon } from "@/components/OwnPayIcon";

type DashboardSection = "home" | "portfolio" | "automation";

export function DashboardSidebar({ active }: { active: DashboardSection }) {
  return (
    <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
      <div className="dashboard-sidebar-label">Your account</div>
      <Link className={`dashboard-nav-item${active === "home" ? " dashboard-nav-active" : ""}`} href="/app" aria-current={active === "home" ? "page" : undefined}><OwnPayIcon name="home" size={18} /> Home</Link>
      <Link className={`dashboard-nav-item${active === "portfolio" ? " dashboard-nav-active" : ""}`} href="/portfolio" aria-current={active === "portfolio" ? "page" : undefined}><OwnPayIcon name="wallet" size={18} /> Portfolio</Link>
      <Link className={`dashboard-nav-item${active === "automation" ? " dashboard-nav-active" : ""}`} href="/automation" aria-current={active === "automation" ? "page" : undefined}><OwnPayIcon name="spark" size={18} /> Automation</Link>
      <Link className="dashboard-nav-item" href="/pay"><OwnPayIcon name="send" size={18} /> Pay</Link>
      <Link className="dashboard-nav-item" href="/gift"><OwnPayIcon name="gift" size={18} /> Gift</Link>
      <Link className="dashboard-nav-item" href="/tip"><OwnPayIcon name="tip" size={18} /> Tip</Link>
      <div className="dashboard-sidebar-rule" />
      <Link className="dashboard-nav-item" href="/app#grants"><OwnPayIcon name="claim" size={18} /> My grants</Link>
      <Link className="dashboard-nav-item" href="/app#activity"><OwnPayIcon name="activity" size={18} /> Activity</Link>
      <div className="dashboard-sidebar-bottom">
        <span className="dashboard-nav-item dashboard-nav-muted"><OwnPayIcon name="shield" size={18} /> Self-custodied</span>
      </div>
    </aside>
  );
}
