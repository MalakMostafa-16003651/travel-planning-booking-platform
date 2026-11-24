import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { NewBookingFlow, type SelectedOffer } from '@/features/flight-bookings/new-booking-flow';
import { SelectionMissing, TravelerOnly } from '@/features/flight-bookings/page-states';
import { parseSelection, selectionHref } from '@/features/flight-bookings/selection';
import { findLiveHold, loadFlight } from '@/features/flight-bookings/server';
import { getServerSession } from '@/lib/api/server-session';

// Rendering: dynamic SSR shell (session, live seats and prices) around a client form.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book a flight', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;

export default async function NewFlightBookingPage({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = (await searchParams).selection;
  const selection = parseSelection(Array.isArray(raw) ? raw[0] : raw);
  const user = await getServerSession();
  // ACC-10: a guest signs in and comes back to the same flights.
  if (!user) redirect(loginHref(selection ? selectionHref(selection) : '/bookings/flights/new'));
  if (user.role !== 'USER') return <TravelerOnly />;
  if (!selection) return <SelectionMissing message="Search for a flight, choose a cabin, and you will come back here to enter the travelers." />;

  const now = new Date();
  const [flights, liveHold] = await Promise.all([
    Promise.all(selection.segments.map(segment => loadFlight(segment.flightId))),
    findLiveHold(selection.segments, now),
  ]);
  const offers = selection.segments.flatMap((segment, index): SelectedOffer[] => {
    const flight = flights[index];
    const cabin = flight?.cabins.find(option => option.cabinId === segment.cabinId);
    return flight && cabin && flight.status === 'SCHEDULED' && new Date(flight.departureAtUtc) > now ? [{ flight, cabin }] : [];
  });
  if (offers.length !== selection.segments.length) {
    return <SelectionMissing message="The flight or cabin you chose is no longer available. Search again to see what is." />;
  }

  return <NewBookingFlow selection={selection} offers={offers} today={now.toISOString().slice(0, 10)} liveHoldId={liveHold?.flightBookingId} />;
}
