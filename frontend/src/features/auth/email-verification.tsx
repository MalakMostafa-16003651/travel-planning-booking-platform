'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { safeReturnPath } from '@/config/routes';
import { ApiError, apiClient } from '@/lib/api/client';
import { useSession } from './session-provider';

export interface EmailVerificationStatus {
  emailVerified: boolean;
  requiredForBooking: boolean;
}

type VerificationState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; status: EmailVerificationStatus }
  | { kind: 'error'; message: string };

export function useEmailVerification(): VerificationState & { refresh: () => void } {
  const { user, loading, error, refresh: refreshSession } = useSession();
  const userId = user?.userId;
  const [requestVersion, setRequestVersion] = useState(0);
  const [result, setResult] = useState<{
    userId: string;
    value: Extract<VerificationState, { kind: 'ready' | 'error' }>;
  }>();
  const refreshStatus = useCallback(() => setRequestVersion(version => version + 1), []);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void apiClient<EmailVerificationStatus>('/auth/email-verification', { signal: controller.signal })
      .then(status => {
        if (!controller.signal.aborted) setResult({ userId, value: { kind: 'ready', status } });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ userId, value: { kind: 'error', message: 'Could not check email verification. Please try again.' } });
        }
      });
    return () => controller.abort();
  }, [requestVersion, userId]);

  useEffect(() => {
    if (!userId) return;
    window.addEventListener('focus', refreshStatus);
    return () => window.removeEventListener('focus', refreshStatus);
  }, [refreshStatus, userId]);

  if (error && !userId) return { kind: 'error', message: error, refresh: () => void refreshSession() };
  if (loading && !userId) return { kind: 'loading', refresh: refreshStatus };
  if (!userId) return { kind: 'signed-out', refresh: refreshStatus };
  if (result?.userId !== userId) return { kind: 'loading', refresh: refreshStatus };
  return { ...result.value, refresh: refreshStatus };
}

export function verificationPath(returnTo?: string): string {
  const path = safeReturnPath(returnTo);
  return path ? `/verify-email?returnTo=${encodeURIComponent(path)}` : '/verify-email';
}

export function isEmailVerificationRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.message === 'Verify your email before booking';
}

/** Mount around the action that creates a hold or starts or retries payment. */
export function BookingEmailGate({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const verification = useEmailVerification();
  if (verification.kind === 'loading') return <p role="status">Checking booking eligibility…</p>;
  if (verification.kind === 'signed-out') {
    const path = safeReturnPath(returnTo);
    return <Link href={path ? `/login?returnTo=${encodeURIComponent(path)}` : '/login'}>Sign in to continue</Link>;
  }
  if (verification.kind === 'error') {
    return (
      <div className="grid gap-3">
        <ErrorAlert message={verification.message} />
        <Button variant="secondary" onClick={verification.refresh}>Check again</Button>
      </div>
    );
  }

  if (verification.status.requiredForBooking && !verification.status.emailVerified) {
    return (
      <div className="rounded-control border border-border bg-canvas p-4">
        <p className="font-semibold text-ink">Verify your email before booking.</p>
        <Link href={verificationPath(returnTo)}>Verify your email</Link>
      </div>
    );
  }

  return children;
}
