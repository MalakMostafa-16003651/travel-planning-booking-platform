'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { LoadingState } from '@/components/ui/loading-state';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { formatAirportTime, formatPrice } from '@/lib/flights/format';
import type { Flight, FlightStatus, Page } from '@/lib/flights/types';

const TONE = { SCHEDULED: 'success', CANCELLED: 'danger', DEPARTED: 'neutral' } as const;
const LABEL = { SCHEDULED: 'Scheduled', CANCELLED: 'Cancelled', DEPARTED: 'Departed' } as const;

export function FlightsList() {
  const [status, setStatus] = useState<FlightStatus | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Flight> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const p = new URLSearchParams({ page: String(page) });
    if (status) p.set('status', status);
    apiClient<Page<Flight>>(`/flights/mine?${p}`)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load flights.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, status]);

  const totalPages = data ? data.totalPages ?? Math.max(1, Math.ceil(data.total / (data.pageSize || 10))) : 1;
  return (
    <div className="stack">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0">Your flights</h1>
        <Link href="/moderator/airline/flights/new" className={buttonClassName('primary')}>Create flight</Link>
      </div>
      <div className="max-w-xs">
        <FormField id="status" label="Status">
          <Select value={status} onChange={e => { setStatus(e.target.value as FlightStatus | ''); setPage(1); }}>
            <option value="">All</option><option value="SCHEDULED">Scheduled</option><option value="CANCELLED">Cancelled</option><option value="DEPARTED">Departed</option>
          </Select>
        </FormField>
      </div>
      {loading && <LoadingState label="Loading flights…" />}
      {error && <ErrorAlert message={error} />}
      {!loading && !error && data?.items.length === 0 && <EmptyState title="No flights yet" description="Create your first flight to start selling seats." />}
      {!loading && !error && data && data.items.length > 0 && (
        <ul className="m-0 grid list-none gap-3 p-0">
          {data.items.map(f => (
            <li key={f.flightId} className="grid gap-2 rounded-card border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-ink">{f.flightNumber} · {f.departureAirport.code} → {f.arrivalAirport.code}</strong>
                <Badge tone={TONE[f.status]}>{LABEL[f.status]}</Badge>
              </div>
              <p className="m-0 text-sm text-muted">
                {formatAirportTime(f.departureAtUtc, f.departureAirport.timeZone)} ({f.departureAirport.code}) → {formatAirportTime(f.arrivalAtUtc, f.arrivalAirport.timeZone)} ({f.arrivalAirport.code})
              </p>
              <p className="m-0 text-sm text-muted">
                {f.cabins.length === 0 ? 'No cabins yet' : f.cabins.map(c => `${c.cabinClass}: ${c.seatsRemaining} left, ${formatPrice(c.price)}`).join(' · ')}
              </p>
              <div className="flex flex-wrap gap-3 text-sm font-semibold">
                <Link href={`/moderator/airline/flights/${f.flightId}`}>Manage</Link>
                <Link href={`/moderator/airline/passengers?flightId=${f.flightId}`}>Passengers</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </nav>
      )}
    </div>
  );
}
