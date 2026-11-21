'use client';
import Link from 'next/link';
import { useSession } from './session-provider';
import { buttonClassName } from '@/components/ui/button';
export function HeaderAccount() {
  const { user, loading } = useSession();
  return loading ? <span role="status" className="muted text-sm">Checking session...</span> : <Link href={user ? '/account/profile' : '/login'} className={buttonClassName('secondary')}>{user ? 'Your account' : 'Sign in'}</Link>;
}
