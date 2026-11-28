'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { roleLabels, roleWorkspaces } from '@/config/routes';
import { useSession } from './session-provider';
import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';

export function SessionActions() {
  const { user, clear } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);
  async function logout() {
    setBusy(true); setError('');
    try {
      await apiClient<void>('/auth/logout', { method: 'POST' });
      clear(); router.replace('/login'); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign out'); }
    finally { setBusy(false); }
  }
  if (!user) return null;
  const links = [
    { href: roleWorkspaces[user.role], label: 'Workspace' },
    ...(user.role === 'USER' ? [{ href: '/bookings', label: 'Bookings' }] : []),
    { href: '/account/profile', label: 'Profile' },
    { href: '/account/security', label: 'Security' },
    { href: '/verify-email', label: 'Email verification' },
  ];
  return (
    <div className="account-bar">
      <div className="page-container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <span className="font-semibold text-ink">{roleLabels[user.role]}</span>
        <Button
          className="md:hidden"
          variant="secondary"
          aria-expanded={open}
          aria-controls="account-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={16} aria-hidden="true" /> : <Menu size={16} aria-hidden="true" />}
          Account menu
        </Button>
        <nav
          id="account-navigation"
          aria-label="Account navigation"
          className={`${open ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-x-4 gap-y-2 md:flex md:w-auto`}
        >
          {links.map(({href, label}) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-control px-2 text-sm hover:underline aria-[current=page]:font-semibold aria-[current=page]:underline"
            >{label}</Link>
          ))}
        </nav>
        <Button variant="secondary" onClick={logout} disabled={busy}>{busy ? 'Signing out...' : 'Sign out'}</Button>
        {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
