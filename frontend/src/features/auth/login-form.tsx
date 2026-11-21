'use client';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '@/lib/api/client';
import type { LoginResult } from '@/types/auth';
import { roleWorkspaces, safeReturnPath } from '@/config/routes';
import { useSession } from './session-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { ErrorAlert } from '@/components/ui/error-alert';

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const search = useSearchParams();
  const { refresh, clear } = useSession();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(''); setFields({});
    try {
      const result = await apiClient<LoginResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
      const returnTo = safeReturnPath(search.get('returnTo'));
      if ('passwordChangeRequired' in result) {
        clear();
        router.replace(`/account/security?required=1${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`);
        return;
      }
      const user = await refresh();
      if (!user) throw new Error('Sign in succeeded, but your browser session could not be confirmed. Try again.');
      router.replace(returnTo || roleWorkspaces[user.role]);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in');
      if (error instanceof ApiError) setFields(error.fields);
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="stack" aria-busy={busy}>
    {search.get('passwordChanged') === '1' && <p role="status">Password changed. Sign in with your new password.</p>}
    {error && <ErrorAlert message={error} />}
    <FormField id="email" label="Email" error={fields.email?.[0]}><Input id="email" name="email" type="email" autoComplete="username" required maxLength={254} aria-invalid={!!fields.email} /></FormField>
    <FormField id="password" label="Password" error={fields.password?.[0]}><Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!fields.password} /></FormField>
    <Button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
  </form>;
}
