import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-3 rounded-card border border-border bg-canvas p-6 text-center">
      <p className="m-0 font-heading font-bold text-ink">{title}</p>
      {description && <p className="m-0 max-w-prose text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
