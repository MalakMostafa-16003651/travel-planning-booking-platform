import type { ComponentProps } from 'react';
import Link from 'next/link';
import { buttonClassName, type ButtonVariant } from '@/components/ui/button';

/**
 * A link that looks like the shared Button. globals.css colors every <a> outside Tailwind's layers, which
 * beats the button's own text color, so the color is set as important here.
 */
export function LinkButton({ variant = 'primary', className = '', ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; className?: string }) {
  const color = variant === 'secondary' ? 'text-ink!' : 'text-white!';
  return <Link className={buttonClassName(variant, `${color} ${className}`)} {...props} />;
}
