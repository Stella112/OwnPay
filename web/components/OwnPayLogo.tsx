import Image from "next/image";

export function OwnPayLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "ownpay-logo ownpay-logo-compact" : "ownpay-logo"}>
      <Image
        src="/ownpay-logo-lockup.png"
        alt="OwnPay"
        width={185}
        height={62}
        priority
        className="ownpay-logo-image"
      />
    </span>
  );
}
