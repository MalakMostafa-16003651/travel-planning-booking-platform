import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { loginHref } from '@/config/routes';
import { BookingStatusBadge, effectiveStatus } from '@/components/booking/booking-status';
import { bookingGroups, listHref } from '@/features/flight-bookings/booking-list';
import { FlightTicket } from '@/features/flight-bookings/flight-ticket';
import { count, daysUntil } from '@/features/flight-bookings/format';
import { LinkButton } from '@/features/flight-bookings/link-button';
import { LoadFailed, TravelerOnly } from '@/features/flight-bookings/page-states';
import { loadAirports, loadBookings, settle } from '@/features/flight-bookings/server';
import type { Airport, FlightBooking } from '@/features/flight-bookings/types';
import { getServerSession } from '@/lib/api/server-session';

// Rendering: dynamic SSR. Private to the signed-in traveler, read fresh on every request and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your bookings', robots: { index: false } };

export default async function BookingsHubPage() {
  const user = await getServerSession();
  if (!user) redirect(loginHref('/bookings'));
  if (user.role !== 'USER') return <TravelerOnly />;

  const [upcoming, past, cancelled, airports] = await Promise.all([
    loadBookings('UPCOMING'), loadBookings('PAST'), loadBookings('CANCELLED'), loadAirports(),
  ]);
  const flights = settle(upcoming, '/bookings');
  if (flights.kind === 'forbidden') return <TravelerOnly />;
  if (flights.kind === 'error') return <LoadFailed message={flights.message} retryHref="/bookings" />;

  const serverNow = new Date().toISOString();
  const [next] = flights.data.items;
  const totals = {
    UPCOMING: flights.data.total,
    PAST: past.kind === 'ok' ? past.data.total : null,
    CANCELLED: cancelled.kind === 'ok' ? cancelled.data.total : null,
  };

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Your bookings</p>
        <h1 className="m-0">Hello, {user.name.split(' ')[0]}.</h1>
      </header>

      <section aria-labelledby="next-flight" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="next-flight" className="m-0">{next ? 'Next flight' : 'Flights'}</h2>
          <Link href="/bookings/flights">All flight bookings</Link>
        </div>
        {next
          ? <NextFlight booking={next} airports={airports} serverNow={serverNow} />
          : <EmptyState title="No upcoming flights" description="Find a flight and your booking will appear here." action={<LinkButton href="/flights">Search flights</LinkButton>} />}
      </section>

      <nav aria-label="Flight bookings by group">
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
          {bookingGroups.map(({ group, label }) => (
            <li key={group}>
              <Link href={listHref(group)} className="flex min-h-11 items-baseline justify-between gap-3 rounded-card border border-border bg-card p-5 text-ink no-underline transition-colors duration-200 hover:border-primary">
                <span className="font-semibold">{label}</span>
                <span className="font-heading text-2xl font-bold tabular-nums">{totals[group] ?? '–'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Osama's hotel booking summary joins this hub here. */}
    </div>
  );
}

function NextFlight({ booking, airports, serverNow }: { booking: FlightBooking; airports: Record<string, Airport>; serverNow: string }) {
  const status = effectiveStatus(booking.status, booking.holdExpiresAt, serverNow);
  // On a round trip that has already started, the return is what comes next.
  const segment = booking.segments.find(({ departureAt }) => new Date(departureAt) > new Date(serverNow)) ?? booking.segments[0];
  const id = booking.flightBookingId;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BookingStatusBadge status={status} />
        <span className="text-sm text-muted">{daysUntil(segment.departureAt, serverNow)} · {count(booking.passengers.length, 'traveler')}{booking.segments.length > 1 && ' · Round trip'}</span>
      </div>
      <FlightTicket segment={segment} airports={airports}>
        {booking.bookingReference && (
          <div>
            <dt className="text-xs text-muted">Reference</dt>
            <dd className="m-0 font-heading font-bold tracking-widest text-ink">{booking.bookingReference}</dd>
          </div>
        )}
      </FlightTicket>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={`/bookings/flights/${id}`}>{status === 'PENDING' ? 'Finish this booking' : 'View booking'}</LinkButton>
        {status === 'CONFIRMED' && <LinkButton href={`/bookings/flights/${id}/ticket`} variant="secondary">View ticket</LinkButton>}
      </div>
    </div>
  );
}
