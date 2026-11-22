import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-11 w-full rounded-control border border-border bg-card py-2.5 pl-3 pr-8 text-base text-body aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-canvas ${className}`}
      {...props}
    />
  );
}
