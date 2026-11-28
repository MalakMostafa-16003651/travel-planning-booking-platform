'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { ApiError, apiClient } from '@/lib/api/client';
import { cabinLabel, formatAirportDate, formatAirportClock, formatDuration, formatPrice, zoneLabel } from '@/lib/flights/format';
import type { Flight } from '@/lib/flights/types';

export function FlightDetails({ flightId }: { flightId: string }) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    apiClient<Flight>(`/flights/${encodeURIComponent(flightId)}`)
      .then(data => { if (alive) setFlight(data); })
      .catch(e => {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setNotFound(true);
        else setError(e instanceof Error ? e.message : 'Could not load this flight.');
      });
    return () => { alive = false; };
  }, [flightId]);

  if (notFound) return <div className="stack"><h1>Flight not found</h1><p>This flight does not exist or is no longer available.</p><Link href="/flights" className={buttonClassName('secondary')}>Search flights</Link></div>;
  if (error) return <ErrorAlert message={error} />;
  if (!flight) return <LoadingState label="Loading flight…" />;

  const { departureAirport: dep, arrivalAirport: arr } = flight;
  const tiers = [...(flight.cancellationTiers ?? [])].sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture);
  return (
    <div className="stack">
      <div>
        <h1>{dep.city} → {arr.city}</h1>
        <p className="m-0 text-muted">{flight.airlineName} · {flight.flightNumber} {flight.status !== 'SCHEDULED' && <Badge tone={flight.status === 'CANCELLED' ? 'danger' : 'neutral'}>{flight.status === 'CANCELLED' ? 'Cancelled' : 'Departed'}</Badge>}</p>
      </div>
      <Card className="grid gap-4 md:grid-cols-3">
        <div>
          <h2 className="m-0 text-base">Departs</h2>
          <p className="m-0 text-xl font-bold text-ink">{formatAirportClock(flight.departureAtUtc, dep.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{formatAirportDate(flight.departureAtUtc, dep.timeZone)} · {zoneLabel(flight.departureAtUtc, dep.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{dep.name} ({dep.code}), {dep.country}</p>
        </div>
        <div>
          <h2 className="m-0 text-base">Duration</h2>
          <p className="m-0 text-xl font-bold text-ink">{formatDuration(flight.durationMinutes)}</p>
        </div>
        <div>
          <h2 className="m-0 text-base">Arrives</h2>
          <p className="m-0 text-xl font-bold text-ink">{formatAirportClock(flight.arrivalAtUtc, arr.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{formatAirportDate(flight.arrivalAtUtc, arr.timeZone)} · {zoneLabel(flight.arrivalAtUtc, arr.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{arr.name} ({arr.code}), {arr.country}</p>
        </div>
      </Card>
      <section aria-labelledby="cabins-h" className="stack">
        <h2 id="cabins-h" className="m-0">Cabins and baggage</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {flight.cabins.map(c => (
            <Card key={c.cabinId} className="grid gap-1">
              <p className="m-0 font-heading font-bold text-ink">{cabinLabel(c.cabinClass)}</p>
              <p className="m-0 text-xl font-bold text-ink">{formatPrice(c.price)} <span className="text-sm font-normal text-muted">per passenger</span></p>
              <p className="m-0 text-sm text-muted">{c.seatsRemaining > 0 ? `${c.seatsRemaining} of ${c.totalSeats} seats left` : 'Sold out'}</p>
              <p className="m-0 text-sm text-muted">Free baggage: {c.baggageAllowanceCount} × up to {c.baggageMaxWeightKg} kg</p>
            </Card>
          ))}
          {flight.cabins.length === 0 && <p className="m-0 text-muted">No cabins have been added to this flight yet.</p>}
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="grid gap-2">
          <h2 className="m-0 text-base">Extra baggage</h2>
          {flight.baggagePolicy
            ? <p className="m-0 text-sm">{formatPrice(flight.baggagePolicy.pricePerExtraBag)} per extra bag, up to {flight.baggagePolicy.maxExtraBagsPerPassenger} per passenger.</p>
            : <p className="m-0 text-sm text-muted">No extra-baggage policy published.</p>}
        </Card>
        <Card className="grid gap-2">
          <h2 className="m-0 text-base">Cancellation policy</h2>
          {tiers.length === 0 && <p className="m-0 text-sm text-muted">No refund tiers published. Cancellations are not refunded.</p>}
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {tiers.map(t => <li key={t.daysBeforeDeparture}>{t.daysBeforeDeparture}+ days before departure: {t.refundPercentage}% refund</li>)}
          </ul>
        </Card>
      </div>
      {flight.status === 'SCHEDULED' && (
        <div className="flex flex-wrap gap-3">
          <Link href="/flights" className={buttonClassName('secondary')}>Back to search</Link>
        </div>
      )}
    </div>
  );
}
