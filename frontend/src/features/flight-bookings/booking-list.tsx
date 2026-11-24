import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BookingStatusBadge, effectiveStatus } from '@/components/booking/booking-status';
import { EmptyState } from '@/components/ui/empty-state';
import { cabinName, count, daysUntil, localClock, localDay, money } from './format';
import { LinkButton } from './link-button';
import type { Airport, BookingGroup, FlightBooking, FlightBookingPage } from './types';

export const bookingGroups: { group: BookingGroup; label: string; empty: { title: string; description: string } }[] = [
  { group: 'UPCOMING', label: 'Upcoming', empty: { title: 'No upcoming flights', description: 'Flights you hold or confirm appear here.' } },
  { group: 'PAST', label: 'Past', empty: { title: 'No past flights yet', description: 'Trips move here after their last departure.' } },
  { group: 'CANCELLED', label: 'Cancelled', empty: { title: 'Nothing cancelled', description: 'Cancelled bookings and holds that ran out appear here.' } },
];

export function listHref(group: BookingGroup, page = 1): string {
  const query = new URLSearchParams({ group });
  if (page > 1) query.set('page', String(page));
  return `/bookings/flights?${query}`;
}

export function GroupTabs({ current }: { current: BookingGroup }) {
  return (
    <nav aria-label="Booking groups" className="flex gap-2 overflow-x-auto border-b border-border">
      {bookingGroups.map(({ group, label }) => (
        <Link
          key={group}
          href={listHref(group)}
          aria-current={group === current ? 'page' : undefined}
          className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm no-underline ${group === current ? 'border-primary font-semibold text-ink!' : 'border-transparent text-muted! hover:text-ink!'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BookingRow({ booking, airports, serverNow }: { booking: FlightBooking; airports: Record<string, Airport>; serverNow: string }) {
  const [outbound] = booking.segments;
  const status = effectiveStatus(booking.status, booking.holdExpiresAt, serverNow);
  const city = (code: string) => airports[code]?.city ?? code;
  const roundTrip = booking.segments.length > 1;
  const cabins = [...new Set(booking.segments.map(segment => cabinName(segment.cabinClass)))].join(' / ');

  return (
    <article className="group relative grid gap-4 rounded-card border border-border bg-card p-5 transition-colors duration-200 hover:border-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <BookingStatusBadge status={status} />
          {booking.bookingReference && <span className="font-heading text-sm font-bold tracking-widest text-ink">{booking.bookingReference}</span>}
          {(status === 'CONFIRMED' || status === 'PENDING') && <span className="text-sm text-muted">{daysUntil(outbound.departureAt, serverNow)}</span>}
        </div>
        <h2 className="m-0 flex flex-wrap items-center gap-x-3">
          <Link href={`/bookings/flights/${booking.flightBookingId}`} className="text-ink! no-underline after:absolute after:inset-0 after:rounded-card group-hover:underline">
            <span className="sr-only">{city(outbound.departureAirportCode)} to {city(outbound.arrivalAirportCode)}, view booking</span>
            <span aria-hidden="true" className="inline-flex items-center gap-2 tracking-tight">
              {outbound.departureAirportCode}<ArrowRight size={20} className="text-primary" />{outbound.arrivalAirportCode}
            </span>
          </Link>
          <span className="text-sm font-normal tracking-normal text-muted">{city(outbound.departureAirportCode)} to {city(outbound.arrivalAirportCode)}{roundTrip && ', round trip'}</span>
        </h2>
        <p className="m-0 text-sm text-muted">
          {booking.segments.map(segment => segment.flightNumber).join(' / ')}
          {' · '}{localDay(outbound.departureAt, outbound.departureTimeZone)}, {localClock(outbound.departureAt, outbound.departureTimeZone)}
          {' · '}{cabins}
          {' · '}{count(booking.passengers.length, 'traveler')}
        </p>
      </div>
      <p className="m-0 font-heading text-xl font-bold tabular-nums text-ink sm:text-right">{money(booking.totalAmount, booking.currency)}</p>
    </article>
  );
}

/** Server pages of ten (GEN-05). This endpoint sends no totalPages, so it is derived from the total. */
export function BookingList({ group, data, airports, serverNow }: { group: BookingGroup; data: FlightBookingPage; airports: Record<string, Airport>; serverNow: string }) {
  const { empty } = bookingGroups.find(entry => entry.group === group)!;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  if (data.total === 0) return <EmptyState {...empty} action={group === 'UPCOMING' ? <LinkButton href="/flights">Search flights</LinkButton> : undefined} />;
  if (data.items.length === 0) return <EmptyState title="This page is empty" description="There are fewer bookings than before." action={<LinkButton href={listHref(group)} variant="secondary">Go to the first page</LinkButton>} />;

  return (
    <div className="grid gap-5">
      <p className="m-0 text-sm text-muted">{count(data.total, 'booking')}</p>
      <ul className="m-0 grid list-none gap-4 p-0">
        {data.items.map(booking => <li key={booking.flightBookingId}><BookingRow booking={booking} airports={airports} serverNow={serverNow} /></li>)}
      </ul>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {data.page > 1 ? <LinkButton variant="secondary" href={listHref(group, data.page - 1)}>Previous</LinkButton> : <span />}
          <span className="text-sm text-muted">Page {data.page} of {pages}</span>
          {data.page < pages ? <LinkButton variant="secondary" href={listHref(group, data.page + 1)}>Next</LinkButton> : <span />}
        </nav>
      )}
    </div>
  );
}
