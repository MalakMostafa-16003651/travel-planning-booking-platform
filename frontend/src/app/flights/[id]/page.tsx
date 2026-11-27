import type { Metadata } from 'next';
import { FlightDetails } from '@/features/flights/flight-details';

// Rendering: dynamic. Seat counts change with every booking, so nothing is cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Flight details' };

export default async function FlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FlightDetails flightId={id} />;
}
