import { CircleAlert } from "lucide-react";

export function ErrorAlert({ message, title = "We couldn’t complete that" }: { message: string; title?: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-control border border-danger bg-card p-4 text-danger">
      <CircleAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        <p className="m-0 text-sm font-semibold">{title}</p>
        <p className="m-0 mt-1 text-sm">{message}</p>
      </div>
    </div>
  );
}
