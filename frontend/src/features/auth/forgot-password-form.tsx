'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, apiClient } from '@/lib/api/client';

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [accepted, setAccepted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true);
    setError('');
    setEmailError(undefined);

    try {
      await apiClient<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setAccepted(true);
    } catch (error) {
      if (error instanceof ApiError && error.fields.email?.[0]) {
        setEmailError(error.fields.email[0]);
      } else {
        setError(error instanceof ApiError && error.status === 503
          ? 'Password recovery is temporarily unavailable. Please try again later.'
          : 'Could not request a reset link. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <>
        <p role="status">If an eligible account exists, a password reset link will be sent.</p>
        <Link href="/login">Back to sign in</Link>
      </>
    );
  }

  return (
    <>
      <p className="muted">Enter the email address you use to sign in.</p>
      <form onSubmit={submit} method="post" aria-busy={busy}>
        {error && <ErrorAlert message={error} />}
        <FormField id="recovery-email" label="Email" error={emailError}>
          <Input name="email" type="email" autoComplete="email" maxLength={254} required />
        </FormField>
        <Button type="submit" disabled={busy}>{busy ? 'Requesting link…' : 'Send reset link'}</Button>
      </form>
      <Link href="/login">Back to sign in</Link>
    </>
  );
}
