type IconName = "arrow" | "home" | "send" | "gift" | "tip" | "claim" | "activity" | "shield" | "spark" | "menu" | "close" | "wallet" | "check" | "copy";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
  send: <><path d="m21 3-7.2 18-3.7-7.1L3 10.2 21 3Z" /><path d="M10.1 13.9 21 3" /></>,
  gift: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8H8.5a2.5 2.5 0 1 1 2.5-2.5V8Zm0 0h3.5a2.5 2.5 0 1 0-2.5-2.5V8Z" /></>,
  tip: <><path d="M20 12a8 8 0 1 1-4-6.9" /><path d="M20 4v5h-5" /><path d="M8 13.5c.7.8 1.6 1.2 2.8 1.2 1.3 0 2.2-.6 2.2-1.5 0-2.2-5-1.1-5-3.7 0-1 .8-1.8 2.1-2" /></>,
  claim: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  activity: <><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></>,
  shield: <><path d="M12 3 20 6v5c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v15H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" /><path d="M4 8h16" /><path d="M16 13h2" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
};

export function OwnPayIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
