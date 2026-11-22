'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, apiClient } from '@/lib/api/client';
import { useAuthProof } from './auth-proof';
import { passwordError, passwordHint } from './password-rules';
import { useSession } from './session-provider';

export function ResetPasswordForm() {
  const proof = useAuthProof();

  if (proof.state.kind === 'loading') return <p role="status">Checking the reset link…</p>;
  if (proof.state.kind !== 'ready') return <InvalidResetLink />;
  return <ResetForm key={proof.state.version} readProof={proof.read} discardProof={proof.discard} />;
}

function InvalidResetLink() {
  return (
    <>
      <ErrorAlert message="This password reset link is missing, invalid or expired." />
      <p>Reopen the latest email or request a new link.</p>
      <Link href="/forgot-password">Request a new reset link</Link>
    </>
  );
}

function ResetForm({ readProof, discardProof }: {
  readProof: () => string | null;
  discardProof: (token: string) => void;
}) {
  const router = useRouter();
  const { clear } = useSession();
  const [busy, setBusy] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [error, setError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState<string>();
  const [confirmationError, setConfirmationError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const token = readProof();
    if (!token) {
      setInvalidLink(true);
      return;
    }

    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('newPassword') ?? '');
    const validationError = passwordError(newPassword);
    const mismatch = newPassword !== data.get('confirmation');
    setError('');
    setNewPasswordError(validationError);
    setConfirmationError(mismatch ? 'Enter the same password in both fields.' : undefined);
    if (validationError || mismatch) return;

    setBusy(true);
    try {
      await apiClient<void>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      discardProof(token);
      clear();
      router.replace('/login?passwordChanged=1');
    } catch (error) {
      if (error instanceof ApiError && error.fields.newPassword?.[0]) {
        setNewPasswordError(error.fields.newPassword[0]);
      } else if (error instanceof ApiError && error.status === 400) {
        if (error.fields.token?.length || error.message === 'Invalid or expired password reset link') {
          discardProof(token);
          setInvalidLink(true);
        } else {
          setError(error.message);
        }
      } else {
        setError(error instanceof ApiError && error.status === 429
          ? 'Too many password reset attempts. Try again later.'
          : 'Could not reset your password. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (invalidLink) return <InvalidResetLink />;

  return (
    <form onSubmit={submit} method="post" aria-busy={busy}>
      {error && <ErrorAlert message={error} />}
      <FormField id="reset-password" label="New password" error={newPasswordError} hint={passwordHint}>
        <Input type="password" name="newPassword" autoComplete="new-password" required />
      </FormField>
      <FormField id="reset-confirmation" label="Confirm new password" error={confirmationError}>
        <Input type="password" name="confirmation" autoComplete="new-password" required />
      </FormField>
      <Button type="submit" disabled={busy}>{busy ? 'Resetting password…' : 'Reset password'}</Button>
    </form>
  );
}
