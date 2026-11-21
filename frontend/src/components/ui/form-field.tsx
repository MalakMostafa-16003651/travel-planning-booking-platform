import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type FieldControl = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

export function FormField({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<FieldControl>, { id, "aria-describedby": describedBy, "aria-invalid": Boolean(error) })
    : children;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {control}
      {hint && <p id={`${id}-hint`} className="m-0 text-sm text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
