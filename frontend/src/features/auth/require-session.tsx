'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from './session-provider';
import type { UserRole } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';

export function RequireSession({ children, role }: { children: ReactNode; role?: UserRole }) {
  const { user, loading, error, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!loading && !user && !error) router.replace(`/login?returnTo=${encodeURIComponent(pathname + (search.size ? `?${search}` : ''))}`);
  }, [user, loading, error, router, pathname, search]);
  if (loading) return <p role="status">Checking your session...</p>;
  if (error) return <div className="stack"><ErrorAlert message={error} /><Button onClick={() => void refresh()}>Try again</Button></div>;
  if (!user) return <p role="status">Taking you to sign in...</p>;
  if (role && user.role !== role) return <div className="stack"><h1>Access denied</h1><p>Your account cannot open this workspace.</p></div>;
  return children;
}
