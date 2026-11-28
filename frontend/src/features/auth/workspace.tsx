'use client';
import Link from 'next/link';
import type { UserRole } from '@/types/auth';
import { RequireSession } from './require-session';
import { useSession } from './session-provider';
import { roleLabels } from '@/config/routes';
import { Badge } from '@/components/ui/badge';

export function Workspace({ role }: { role: UserRole }) {
  const { user } = useSession();
  return (
    <RequireSession role={role}>
      <section className="auth-shell">
        <div className="auth-card stack">
          <div><Badge>{roleLabels[role]}</Badge></div>
          <h1>Your workspace</h1>
          <p>Welcome, {user?.name}.</p>
          <nav aria-label="Workspace shortcuts" className="flex flex-wrap gap-4">
            {role === 'USER' && (
              <>
                <Link href="/bookings" className="underline">Bookings</Link>
                <Link href="/itineraries" className="underline">My itineraries</Link>
              </>
            )}
            <Link href="/account/profile" className="underline">Edit profile</Link>
            <Link href="/account/security" className="underline">Change password</Link>
          </nav>
        </div>
      </section>
    </RequireSession>
  );
}
