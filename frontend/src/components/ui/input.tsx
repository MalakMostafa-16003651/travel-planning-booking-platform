import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`min-h-11 w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body placeholder:text-muted aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-canvas ${className}`} {...props} />;
}
