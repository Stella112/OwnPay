import Image from "next/image";
import { OwnPayIcon } from "@/components/OwnPayIcon";

export function CharacterVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "character-stage character-stage-compact" : "character-stage"} aria-label="OwnPay ownership visual">
      <div className="character-aura" />
      <div className="ribbon ribbon-one" />
      <div className="ribbon ribbon-two" />
      <div className="crystal-tile crystal-tile-one"><OwnPayIcon name="spark" size={17} /><strong>AAPLc</strong><span>Apple</span></div>
      <div className="crystal-tile crystal-tile-two"><OwnPayIcon name="activity" size={17} /><strong>NVDAc</strong><span>NVIDIA</span></div>
      <div className="crystal-tile crystal-tile-three"><OwnPayIcon name="gift" size={17} /><strong>Own it</strong><span>on Base</span></div>
      <Image
        src="/ownpay-hero-character-clean.png"
        alt="A person holding a phone with ownership cards around them"
        width={1024}
        height={1536}
        priority={!compact}
        className="character-image"
      />
      {!compact && <div className="character-caption"><span className="caption-dot" /> Real assets. Real people. A brighter tomorrow.</div>}
    </div>
  );
}
