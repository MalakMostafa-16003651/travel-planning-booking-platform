import type { Metadata } from 'next';
import { BookingDetails } from '@/features/flight-bookings/booking-details';
import { LoadFailed, TravelerOnly } from '@/features/flight-bookings/page-states';
import { loadAirports, loadBooking, settle } from '@/features/flight-bookings/server';

// Rendering: dynamic SSR. Status, hold time and refund come from the server on every request.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Flight booking', robots: { index: false } };

export default async function FlightBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/bookings/flights/${encodeURIComponent(id)}`;
  const [result, airports] = await Promise.all([loadBooking(id), loadAirports()]);
  const booking = settle(result, here);
  if (booking.kind === 'forbidden') return <TravelerOnly />;
  if (booking.kind === 'error') return <LoadFailed message={booking.message} retryHref={here} />;
  return <BookingDetails booking={booking.data} airports={airports} serverNow={new Date().toISOString()} />;
}
