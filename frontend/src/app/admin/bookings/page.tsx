import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterDate, FilterSelect, Pagination, TableFilters, dateParam, enumParam, pageCount, pageHref, readPage, type DataTableColumn, type SearchParams } from '@/components/data-table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { AdminNav } from '@/features/admin/admin-nav';
import { AdminAccessDenied, AdminLoadFailed } from '@/features/admin/page-states';
import { BOOKING_STATUSES, BOOKING_TYPES, bookingStatusLabels, type AdminBooking, type BookingStatus } from '@/features/admin/records-types';
import { loadBookings, requireAdmin } from '@/features/admin/server';
import { formatMoneyMinorUnits } from '@/lib/format/money';

// Rendering: dynamic SSR. Admin-only, read-only booking data, fetched fresh and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bookings', robots: { index: false } };

const PATH = '/admin/bookings';
const statusTones: Record<BookingStatus, BadgeTone> = { PENDING: 'warning', CONFIRMED: 'success', COMPLETED: 'info', EXPIRED: 'neutral', CANCELLED: 'danger' };
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function amount(booking: AdminBooking): string {
  // Booking totals are integer minor units (cents), per docs/m2/ROUTES_AND_HANDOFFS.md.
  try { return formatMoneyMinorUnits(booking.totalAmount, booking.currency); } catch { return `${booking.totalAmount} ${booking.currency}`; }
}

const columns: DataTableColumn<AdminBooking>[] = [
  {
    id: 'reference', header: 'Booking', rowHeader: true, cell: booking => (
      <div className="grid justify-items-start gap-1">
        <span>{booking.bookingReference ?? 'No reference yet'}</span>
        <Badge tone={booking.type === 'FLIGHT' ? 'info' : 'neutral'}>{booking.type === 'FLIGHT' ? 'Flight' : 'Hotel'}</Badge>
      </div>
    ),
  },
  {
    id: 'traveler', header: 'Traveler', cell: booking => (
      <div className="grid gap-1">
        <span className="text-ink">{booking.userName ?? 'Unknown user'}</span>
        {booking.userEmail && <span className="text-xs text-muted">{booking.userEmail}</span>}
      </div>
    ),
  },
  { id: 'provider', header: 'Airline or hotel', cell: booking => booking.providerName ?? 'Unknown provider' },
  { id: 'dates', header: 'Travel dates', cell: booking => booking.endDate ? `${day.format(new Date(booking.startDate))} – ${day.format(new Date(booking.endDate))}` : day.format(new Date(booking.startDate)) },
  { id: 'amount', header: 'Total', align: 'end', cell: amount },
  { id: 'status', header: 'Status', cell: booking => <Badge tone={statusTones[booking.status]}>{bookingStatusLabels[booking.status] ?? booking.status}</Badge> },
];

export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const returnTo = pageHref(PATH, params, readPage(params));
  if (!(await requireAdmin(returnTo))) return <AdminAccessDenied />;

  const filters = {
    page: readPage(params),
    type: enumParam(params, 'type', BOOKING_TYPES),
    status: enumParam(params, 'status', BOOKING_STATUSES),
    from: dateParam(params, 'from'),
    to: dateParam(params, 'to'),
  };
  const filtered = Boolean(filters.type || filters.status || filters.from || filters.to);
  const rangeError = filters.from && filters.to && filters.from > filters.to ? 'The "from" date must be on or before the "to" date.' : null;
  const result = rangeError ? null : await loadBookings(filters, returnTo);
  if (result?.kind === 'forbidden') return <AdminAccessDenied />;

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Bookings</h1>
        <p className="muted mb-0">Every flight and hotel booking, newest first. Read-only. Dates filter by departure for flights and check-in for hotels (UTC).</p>
      </div>
      <AdminNav current={PATH} />

      <TableFilters action={PATH} label="Filter bookings">
        <FilterSelect name="type" label="Type" value={filters.type} anyLabel="Flights and hotels" options={[{ value: 'FLIGHT', label: 'Flights' }, { value: 'HOTEL', label: 'Hotels' }]} />
        <FilterSelect name="status" label="Status" value={filters.status} anyLabel="All statuses" options={BOOKING_STATUSES.map(status => ({ value: status, label: bookingStatusLabels[status] }))} />
        <FilterDate name="from" label="Travel from" value={filters.from} />
        <FilterDate name="to" label="Travel to" value={filters.to} />
      </TableFilters>

      {rangeError && <ErrorAlert title="Check the dates" message={rangeError} />}
      {result?.kind === 'invalid' && <ErrorAlert title="Check the filters" message={result.message} />}
      {result?.kind === 'error' && <AdminLoadFailed message={result.message} retryHref={returnTo} />}
      {result?.kind === 'ok' && (
        result.data.total > 0 && result.data.items.length === 0 ? (
          <EmptyState title="This page is empty" description="There are fewer bookings than this page number." action={<Link href={pageHref(PATH, params, 1)} className={buttonClassName('secondary')}>Go to the first page</Link>} />
        ) : (
          <div className="grid gap-4">
            <DataTable
              caption="Bookings"
              columns={columns}
              rows={result.data.items}
              rowKey={booking => `${booking.type}-${booking.bookingId}`}
              empty={<EmptyState title={filtered ? 'No bookings match these filters' : 'No bookings yet'} action={filtered ? <Link href={PATH} className={buttonClassName('secondary')}>Clear filters</Link> : undefined} />}
            />
            <Pagination label="Booking pages" page={result.data.page} totalPages={pageCount(result.data)} total={result.data.total} pageSize={result.data.pageSize} hrefForPage={page => pageHref(PATH, params, page)} />
          </div>
        )
      )}
    </div>
  );
}
