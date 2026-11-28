import type { Metadata } from 'next';
import { AirlineGate } from '@/features/airline-moderator/airline-gate';
import { FlightsList } from '@/features/airline-moderator/flights-list';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your flights' };

export default function AirlineFlightsPage() {
  return <AirlineGate><FlightsList /></AirlineGate>;
}
