import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CharacterVisual } from "@/components/CharacterVisual";
import { OwnPayIcon } from "@/components/OwnPayIcon";

const actions = [
  { href: "/pay", label: "Pay", title: "Create a vesting grant.", copy: "Compensation with a longer view.", icon: "send" as const },
  { href: "/gift", label: "Gift", title: "Lock stock for a meaningful date.", copy: "Make the moment worth more.", icon: "gift" as const },
  { href: "/tip", label: "Tip", title: "Send stock instantly with a note.", copy: "A thank-you that can grow.", icon: "tip" as const },
  { href: "/app#grants", label: "Claim", title: "Receive and claim ownership.", copy: "See what is yours on Base.", icon: "claim" as const },
];

export default function Home() {
  return (
    <AppShell>
      <div className="landing-shell">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="hero-kicker"><span className="kicker-icon"><OwnPayIcon name="spark" size={15} /></span> Pay. Gift. Tip. Own.</span>
            <h1 id="hero-title">Turn every payment<br /><span>into ownership.</span></h1>
            <p>Get paid in USDC or real Coinbase Tokenized Stocks on Base, share one OwnPay Link, and choose how much of your income becomes ownership.</p>
            <div className="hero-actions"><Link href="/app" className="btn btn-primary btn-large">Get started <OwnPayIcon name="arrow" size={18} /></Link><a href="#how-it-works" className="btn btn-butter btn-large"><OwnPayIcon name="spark" size={17} /> How it works</a></div>
            <div className="hero-proof"><span className="proof-mark"><OwnPayIcon name="shield" size={15} /></span><span>Self-custodied on Base</span><span className="proof-divider" /><span>Official B20 assets</span></div>
          </div>
          <div className="hero-visual"><CharacterVisual /><div className="hero-stamp">More<br />people<br /><em>own.</em></div></div>
        </section>

        <section id="product" className="principles-strip" aria-label="OwnPay principles">
          <div><span className="eyebrow">A new payment primitive</span><h2>Real assets. Real people. A brighter tomorrow.</h2></div>
          <p>OwnPay brings everyday payments, programmable stock ownership, and user-controlled automation together on Base.</p>
        </section>

        <section id="how-it-works" className="landing-section" aria-labelledby="how-title">
          <div className="section-heading landing-heading"><div><span className="eyebrow">One primitive, four ways to use it</span><h2 id="how-title">Move ownership with intention.</h2></div><p>Built on a single escrow rail that keeps the real share claim locked, vesting, and visible.</p></div>
          <div className="action-grid">{actions.map((action, index) => <Link className={`action-card action-card-${index + 1}`} href={action.href} key={action.label}><span className="action-card-number">0{index + 1}</span><span className="action-icon"><OwnPayIcon name={action.icon} size={24} /></span><h3>{action.label}</h3><strong>{action.title}</strong><p>{action.copy}</p><span className="action-arrow"><OwnPayIcon name="arrow" size={17} /></span></Link>)}</div>
        </section>

        <section id="use-cases" className="story-section" aria-labelledby="story-title">
          <div className="story-visual"><div className="story-orb orb-one" /><div className="story-orb orb-two" /><div className="story-card story-card-main"><span className="story-card-icon"><OwnPayIcon name="claim" size={20} /></span><span className="eyebrow">A claim that grows</span><strong>Shares vest<br />as time moves.</strong><span className="story-line"><i /><i /><i /><i /><i /></span><small>Raw B20 accounting · scaled share display</small></div><div className="story-mini-card"><OwnPayIcon name="gift" size={17} /><span>Made for<br />meaningful moments.</span></div></div>
          <div className="story-copy"><span className="eyebrow">Why OwnPay</span><h2 id="story-title">Ownership should move as easily as money.</h2><p>Stablecoins made global payments easier. OwnPay makes ownership programmable for eligible users outside the United States.</p><div className="story-points"><div><span className="point-icon"><OwnPayIcon name="shield" size={18} /></span><span><strong>B20-native</strong><small>Corporate actions stay reflected through the token multiplier.</small></span></div><div><span className="point-icon"><OwnPayIcon name="wallet" size={18} /></span><span><strong>Self-custodied</strong><small>Recipients claim directly to their own connected wallet.</small></span></div></div><Link href="/app" className="text-link">Open your dashboard <OwnPayIcon name="arrow" size={16} /></Link></div>
        </section>

        <section id="roadmap" className="roadmap-section" aria-labelledby="roadmap-title"><div><span className="eyebrow">What comes next</span><h2 id="roadmap-title">The rails are live.<br />The economy is just getting started.</h2></div><div className="roadmap-list"><div><span>01</span><strong>Recurring grants</strong><small>Repeat a saved Pay grant each period.</small></div><div><span>02</span><strong>Employer matches</strong><small>Reward spending with stock-back ownership.</small></div><div><span>03</span><strong>Programmable rules</strong><small>Every paycheck can become a portfolio.</small></div></div><p className="roadmap-note">Future directions · not available today</p></section>

        <section className="eligibility-banner"><div><span className="eyebrow">Before you send</span><h2>Real stock comes with real responsibility.</h2></div><p>OwnPay is a self-custodial interface for eligible users in permitted jurisdictions outside the United States. It does not verify legal eligibility.</p></section>
      </div>
    </AppShell>
  );
}
