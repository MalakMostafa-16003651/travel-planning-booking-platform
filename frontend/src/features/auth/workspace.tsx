'use client';
import Link from 'next/link';
import type { UserRole } from '@/types/auth';
import { RequireSession } from './require-session';
import { useSession } from './session-provider';
export function Workspace({ role }: { role: UserRole }) {
  const { user } = useSession();
  return <RequireSession role={role}><section className="auth-shell"><div className="auth-card stack"><p className="eyebrow">Connected and ready</p><h1>Your workspace</h1><p>Welcome, {user?.name}.</p><p>Account role: <strong>{user?.role}</strong></p><p className="muted">This shared foundation confirms your session. Your team is building the travel and management features.</p><Link href="/account/profile">View your profile →</Link></div></section></RequireSession>;
}
