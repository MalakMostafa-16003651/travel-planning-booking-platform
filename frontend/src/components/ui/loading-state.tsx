export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-control border border-border bg-canvas px-4 py-3 text-sm text-body">
      <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-primary/25 border-t-primary motion-safe:animate-spin" />
      {label}
    </div>
  );
}
