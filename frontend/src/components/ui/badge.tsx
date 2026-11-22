import type { ReactNode } from "react";

const tones = {
  neutral: "border-border bg-canvas text-ink",
  info: "border-primary/20 bg-primary/10 text-ink",
  success: "border-success/25 bg-success/10 text-ink",
  warning: "border-sand/50 bg-sand/20 text-ink",
  danger: "border-danger/25 bg-danger/10 text-ink",
};

export type BadgeTone = keyof typeof tones;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-snug ${tones[tone]}`}>
      {children}
    </span>
  );
}
