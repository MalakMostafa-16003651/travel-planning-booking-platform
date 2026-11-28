import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonClassName, type ButtonVariant } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';

// The states a checkout or result page shows instead of the payment form. Server Components.

/** A link styled as the shared Button. globals.css colors every <a>, so the text color is forced here. */
export function ActionLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: ButtonVariant }) {
  return <Link href={href} className={buttonClassName(variant, variant === 'secondary' ? 'text-ink!' : 'text-white!')}>{children}</Link>;
}

export function CheckoutNotice({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <section className="stack" aria-labelledby="checkout-notice">
      <h1 id="checkout-notice" className="m-0">{title}</h1>
      <p className="m-0 max-w-prose text-body">{message}</p>
      {action && <div className="flex flex-wrap gap-3">{action}</div>}
    </section>
  );
}

/** Only traveler accounts (role USER) can pay. The backend answers 403 for every other role. */
export function TravelersOnly() {
  return (
    <CheckoutNotice
      title="Access denied"
      message="Only traveler accounts can pay for bookings. Sign in with a traveler account to continue."
      action={<ActionLink href="/" variant="secondary">Back to home</ActionLink>}
    />
  );
}

export function LoadFailed({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <section className="stack">
      <ErrorAlert title="This page could not be loaded" message={message} />
      {/* A full load, so a failed server response is not served again from the router cache. */}
      <div><a href={retryHref}>Try again</a></div>
    </section>
  );
}
