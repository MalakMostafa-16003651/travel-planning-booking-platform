'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { isEmailVerificationRequiredError, verificationPath } from '@/features/auth/email-verification';
import { ApiError } from '@/lib/api/client';

/**
 * Says what went wrong and what to do next. Sign-in opens in a new tab, so a traveler whose session ends
 * half way through a form does not lose what they typed.
 */
export function RequestError({ error, title }: { error: unknown; title?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const here = pathname + (search.size ? `?${search}` : '');

  if (isEmailVerificationRequiredError(error)) {
    return (
      <div className="grid gap-2">
        <ErrorAlert title="Verify your email first" message="Your email must be verified before you can book." />
        <a href={verificationPath(here)} target="_blank" rel="noreferrer">Verify your email (opens in a new tab)</a>
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div className="grid gap-2">
        <ErrorAlert title="Your session has ended" message="Sign in again, then come back here and retry. Nothing you typed is lost." />
        <a href={loginHref(here)} target="_blank" rel="noreferrer">Sign in (opens in a new tab)</a>
      </div>
    );
  }
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
  return <ErrorAlert title={title} message={message} />;
}
