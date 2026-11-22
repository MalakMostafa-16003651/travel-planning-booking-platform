'use client';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '@/lib/api/client';
import { loginHref } from '@/config/routes';
import { useSession } from './session-provider';
import { RequireSession } from './require-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { ErrorAlert } from '@/components/ui/error-alert';
import { passwordError, passwordHint } from './password-rules';

export function SecurityForm() {
  const search = useSearchParams();
  // UI hint only: the backend still requires a valid restricted or normal cookie.
  const required = search.get('required') === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const { clear } = useSession();
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('newPassword') ?? '');
    const invalidPassword = passwordError(newPassword);
    if (invalidPassword) {
      setError('');
      setFields({ newPassword: [invalidPassword] });
      return;
    }
    setBusy(true); setError(''); setFields({});
    try {
      await apiClient<void>('/auth/change-password', { method: 'PATCH', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword }) });
      clear();
      router.replace(loginHref(search.get('returnTo'), { passwordChanged: '1' }));
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to change password');
      if (error instanceof ApiError) setFields(error.fields);
    } finally { setBusy(false); }
  }
  const form = <div className="stack">
    {required ? <p>You need to replace your temporary password before continuing. After changing it, sign in again.</p> : <p>Changing your password ends all existing sessions. You will sign in again.</p>}
    <form method="post" onSubmit={submit} className="stack" aria-busy={busy}>
      {error && <ErrorAlert message={error} />}
      <FormField id="currentPassword" label="Current password" error={fields.currentPassword?.[0]}><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></FormField>
      <FormField id="newPassword" label="New password" error={fields.newPassword?.[0]} hint={passwordHint}><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required /></FormField>
      <Button type="submit" disabled={busy}>{busy ? 'Changing password...' : 'Change password'}</Button>
    </form>
    {required && <Button variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await apiClient<void>('/auth/logout', { method: 'POST' }); clear(); router.replace('/login'); }
      catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign out'); }
      finally { setBusy(false); }
    }}>Sign out</Button>}
  </div>;
  return required ? form : <RequireSession>{form}</RequireSession>;
}
