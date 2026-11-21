'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { roleWorkspaces } from '@/config/routes';
import { useSession } from './session-provider';
import { Button } from '@/components/ui/button';

export function SessionActions() {
  const { user, clear } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  async function logout() {
    setBusy(true); setError('');
    try {
      await apiClient<void>('/auth/logout', { method: 'POST' });
      clear(); router.replace('/login'); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign out'); }
    finally { setBusy(false); }
  }
  if (!user) return null;
  return <div className="stack"><nav aria-label="Account" className="flex flex-wrap items-center gap-4"><Link href={roleWorkspaces[user.role]}>Workspace</Link><Link href="/account/profile">Profile</Link><Link href="/account/security">Security</Link><Button variant="secondary" onClick={logout} disabled={busy}>{busy ? 'Signing out...' : 'Sign out'}</Button></nav>{error && <p role="alert">{error}</p>}</div>;
}
