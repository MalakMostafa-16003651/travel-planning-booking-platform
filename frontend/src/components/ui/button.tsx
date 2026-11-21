import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export function buttonClassName(variant: ButtonVariant = "primary", className = ""): string {
  const variants = {
    primary: "border-primary bg-primary text-white hover:opacity-90",
    secondary: "border-ink bg-card text-ink hover:bg-canvas",
    danger: "border-danger bg-danger text-white hover:opacity-90",
  };
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-5 py-2.5 text-sm font-semibold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`;
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClassName(variant, className)} {...props} />;
}
