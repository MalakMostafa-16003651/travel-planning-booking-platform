import type { Metadata } from 'next';
import Link from 'next/link';
import { BookingList, GroupTabs, listHref } from '@/features/flight-bookings/booking-list';
import { LoadFailed, TravelerOnly } from '@/features/flight-bookings/page-states';
import { loadAirports, loadBookings, settle } from '@/features/flight-bookings/server';
import type { BookingGroup } from '@/features/flight-bookings/types';

// Rendering: dynamic SSR. The group and page live in the URL; the data is private and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Flight bookings', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function FlightBookingsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const asked = one(query.group)?.toUpperCase();
  const group: BookingGroup = asked === 'PAST' || asked === 'CANCELLED' ? asked : 'UPCOMING';
  const requestedPage = Number(one(query.page));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const here = listHref(group, page);

  const [result, airports] = await Promise.all([loadBookings(group, page), loadAirports()]);
  const bookings = settle(result, here);
  if (bookings.kind === 'forbidden') return <TravelerOnly />;

  return (
    <div className="stack">
      <header>
        <Link href="/bookings" className="text-sm">Your bookings</Link>
        <h1 className="m-0 mt-3">Flight bookings</h1>
      </header>
      <GroupTabs current={group} />
      {bookings.kind === 'error'
        ? <LoadFailed message={bookings.message} retryHref={here} />
        : <BookingList group={group} data={bookings.data} airports={airports} serverNow={new Date().toISOString()} />}
    </div>
  );
}
