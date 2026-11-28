'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequireSession } from '@/features/auth/require-session';

const LINKS = [
  { href: '/moderator/airline', label: 'Airline' },
  { href: '/moderator/airline/flights', label: 'Flights' },
];

/** Session + role guard and the small section nav shared by every airline-moderator page. */
export function AirlineGate({ children }: { children: ReactNode }) {
  return (
    <RequireSession role="AIRLINE_MODERATOR">
      <div className="stack">
        <nav aria-label="Airline sections" className="flex flex-wrap gap-4 border-b border-border pb-3 text-sm font-semibold">
          {LINKS.map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        {children}
      </div>
    </RequireSession>
  );
}
