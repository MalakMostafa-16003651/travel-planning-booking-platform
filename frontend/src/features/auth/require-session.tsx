'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from './session-provider';
import type { UserRole } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { loginHref } from '@/config/routes';
import Link from 'next/link';

export function RequireSession({ children, role }: { children: ReactNode; role?: UserRole }) {
  const { user, loading, error, ended, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!loading && !user && !error) {
      const target = pathname + (search.size ? `?${search}` : '') + window.location.hash;
      router.replace(loginHref(target, ended ? { sessionEnded: '1' } : {}));
    }
  }, [user, loading, error, ended, router, pathname, search]);
  if (loading) return <LoadingState label="Checking your session…" />;
  if (error) return <div className="stack"><ErrorAlert message={error} /><Button onClick={() => void refresh()}>Try again</Button></div>;
  if (!user) return <p role="status">Taking you to sign in...</p>;
  if (role && user.role !== role) return <div className="stack"><h1>Access denied</h1><p>Your account cannot open this workspace.</p><Link href="/">Back to home</Link></div>;
  return children;
}
