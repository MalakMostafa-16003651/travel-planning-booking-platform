import type { Metadata } from 'next';
import { AirlineGate } from '@/features/airline-moderator/airline-gate';
import { AirlineProfile } from '@/features/airline-moderator/airline-profile';

// Rendering: dynamic client page behind the airline-moderator guard.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Airline profile' };

export default function AirlinePage() {
  return <AirlineGate><AirlineProfile /></AirlineGate>;
}
