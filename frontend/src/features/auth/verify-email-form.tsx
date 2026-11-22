'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { safeReturnPath } from '@/config/routes';
import { ApiError, apiClient } from '@/lib/api/client';
import { useAuthProof } from './auth-proof';
import { useEmailVerification, verificationPath } from './email-verification';
import { useSession } from './session-provider';

export function VerifyEmailForm() {
  const proof = useAuthProof();
  const search = useSearchParams();
  const candidate = safeReturnPath(search.get('returnTo')) ?? undefined;
  const returnTo = candidate?.split(/[?#]/, 1)[0] === '/verify-email' ? undefined : candidate;

  if (proof.state.kind === 'loading') return <p role="status">Checking the verification link…</p>;
  if (proof.state.kind === 'missing') return <VerificationStatus returnTo={returnTo} />;
  if (proof.state.kind === 'invalid') return <InvalidVerificationLink returnTo={returnTo} />;

  return (
    <VerifyProof
      key={proof.state.version}
      readProof={proof.read}
      discardProof={proof.discard}
      returnTo={returnTo}
    />
  );
}

function InvalidVerificationLink({ returnTo }: { returnTo?: string }) {
  return (
    <>
      <ErrorAlert message="This verification link is invalid or expired. Reopen the newest link or request another one." />
      <VerificationStatus returnTo={returnTo} />
    </>
  );
}

function VerifyProof({ readProof, discardProof, returnTo }: {
  readProof: () => string | null;
  discardProof: (token: string) => void;
  returnTo?: string;
}) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<'verified' | 'invalid'>();
  const loginLink = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login';

  async function verify() {
    if (busy) return;
    const token = readProof();
    if (!token) {
      setOutcome('invalid');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await apiClient<void>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      discardProof(token);
      setOutcome('verified');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        discardProof(token);
        setOutcome('invalid');
      } else {
        setError(error instanceof ApiError && error.status === 429
          ? 'Too many verification attempts. Try again later.'
          : 'Could not verify your email. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (outcome === 'verified') {
    return (
      <>
        <p role="status">Email verified.</p>
        <Link href={user ? returnTo ?? '/account/profile' : loginLink}>
          {user ? 'Continue' : 'Sign in'}
        </Link>
      </>
    );
  }

  if (outcome === 'invalid') return <InvalidVerificationLink returnTo={returnTo} />;

  return (
    <>
      <p>Confirm the email address from your verification link.</p>
      {error && <ErrorAlert message={error} />}
      <Button onClick={() => void verify()} disabled={busy}>
        {busy ? 'Verifying…' : 'Verify email'}
      </Button>
    </>
  );
}

function VerificationStatus({ returnTo }: { returnTo?: string }) {
  const verification = useEmailVerification();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function resend() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await apiClient<{ message: string }>('/auth/resend-verification', {
        method: 'POST',
        body: '{}',
      });
      setMessage(result.message);
    } catch (error) {
      setError(error instanceof ApiError && error.status === 503
        ? 'Verification email is temporarily unavailable. Please try again later.'
        : 'Could not request a verification link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (verification.kind === 'loading') return <p role="status">Checking your email verification…</p>;
  if (verification.kind === 'signed-out') {
    return (
      <>
        <p>Open the newest verification link from your email, or sign in to request another.</p>
        <Link href={`/login?returnTo=${encodeURIComponent(verificationPath(returnTo))}`}>Sign in to resend</Link>
      </>
    );
  }
  if (verification.kind === 'error') {
    return (
      <>
        <ErrorAlert message={verification.message} />
        <Button variant="secondary" onClick={verification.refresh}>Check again</Button>
      </>
    );
  }
  if (verification.status.emailVerified) {
    return (
      <>
        <p role="status">Your email is verified.</p>
        <Link href={returnTo ?? '/account/profile'}>Continue</Link>
      </>
    );
  }

  return (
    <>
      <p>{verification.status.requiredForBooking
        ? 'Verify your email before you make a booking.'
        : 'Open the newest verification link from your email.'}</p>
      {error && <ErrorAlert message={error} />}
      {message && <p role="status">{message}</p>}
      <Button onClick={() => void resend()} disabled={busy}>
        {busy ? 'Requesting link…' : 'Resend verification email'}
      </Button>
      <Button variant="secondary" onClick={verification.refresh}>Check verification again</Button>
      <Link href={returnTo ?? '/account/profile'}>Back</Link>
    </>
  );
}
