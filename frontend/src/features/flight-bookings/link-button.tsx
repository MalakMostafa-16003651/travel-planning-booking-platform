import type { ComponentProps } from 'react';
import Link from 'next/link';
import { buttonClassName, type ButtonVariant } from '@/components/ui/button';

/** A link that looks like the shared Button. */
export function LinkButton({ variant = 'primary', className = '', ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; className?: string }) {
  return <Link className={buttonClassName(variant, className)} {...props} />;
}
