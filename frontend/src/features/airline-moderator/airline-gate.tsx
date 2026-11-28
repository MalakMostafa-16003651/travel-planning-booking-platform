'use client';

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { RequireSession } from '@/features/auth/require-session';
import { useSession } from '@/features/auth/session-provider';

const LINKS = [
  { href: '/moderator/airline', label: 'Airline' },
  { href: '/moderator/airline/flights', label: 'Flights' },
];

function Shell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return (
    <div className="stack">
      <nav aria-label="Airline sections" className="flex flex-wrap gap-4 border-b border-border pb-3 text-sm font-semibold">
        {LINKS.map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
      </nav>
      {/* The key is the signed-in user's id. If another account signs in (for example in another tab),
          the profile and flights views remount, so the previous airline's data and form are never shown. */}
      <Fragment key={user?.userId ?? 'signed-out'}>{children}</Fragment>
    </div>
  );
}

/** Session + role guard and the small section nav shared by every airline-moderator page. */
export function AirlineGate({ children }: { children: ReactNode }) {
  return (
    <RequireSession role="AIRLINE_MODERATOR">
      <Shell>{children}</Shell>
    </RequireSession>
  );
}
