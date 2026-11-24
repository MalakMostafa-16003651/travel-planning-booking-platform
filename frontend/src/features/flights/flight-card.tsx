import Link from 'next/link';
import { Plane } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cabinLabel, formatAirportClock, formatAirportDate, formatDuration, formatPrice, zoneLabel } from '@/lib/flights/format';
import type { Flight, FlightCabin } from '@/lib/flights/types';

export interface FlightCardProps {
  flight: Flight;
  /** When given, each cabin gets a select button. The parent decides what selecting means. */
  onSelectCabin?: (flight: Flight, cabin: FlightCabin) => void;
  selectedCabinId?: string;
  /** Hide the "View details" link (for example inside a booking summary). */
  hideDetailsLink?: boolean;
}

export function FlightCard({ flight, onSelectCabin, selectedCabinId, hideDetailsLink }: FlightCardProps) {
  const { departureAirport: dep, arrivalAirport: arr } = flight;
  const cancelled = flight.status === 'CANCELLED';
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-heading font-bold text-ink">{flight.airlineName} · {flight.flightNumber}</p>
        {flight.status !== 'SCHEDULED' && <Badge tone={cancelled ? 'danger' : 'neutral'}>{cancelled ? 'Cancelled' : 'Departed'}</Badge>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <p className="m-0 text-2xl font-bold text-ink">{formatAirportClock(flight.departureAtUtc, dep.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{dep.city} ({dep.code})</p>
          <p className="m-0 text-xs text-muted">{formatAirportDate(flight.departureAtUtc, dep.timeZone)} · {zoneLabel(flight.departureAtUtc, dep.timeZone)}</p>
        </div>
        <div className="grid justify-items-center text-xs text-muted">
          <Plane size={18} aria-hidden="true" />
          <span>{formatDuration(flight.durationMinutes)}</span>
        </div>
        <div className="text-right">
          <p className="m-0 text-2xl font-bold text-ink">{formatAirportClock(flight.arrivalAtUtc, arr.timeZone)}</p>
          <p className="m-0 text-sm text-muted">{arr.city} ({arr.code})</p>
          <p className="m-0 text-xs text-muted">{formatAirportDate(flight.arrivalAtUtc, arr.timeZone)} · {zoneLabel(flight.arrivalAtUtc, arr.timeZone)}</p>
        </div>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {flight.cabins.map(cabin => {
          const soldOut = cabin.seatsRemaining <= 0;
          return (
            <li key={cabin.cabinId} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-canvas px-3 py-2">
              <span className="text-sm">
                <strong className="text-ink">{cabinLabel(cabin.cabinClass)}</strong>{' '}
                <span className="text-muted">· {soldOut ? 'Sold out' : `${cabin.seatsRemaining} seats left`}</span>
              </span>
              <span className="flex items-center gap-3">
                <strong className="text-ink">{formatPrice(cabin.price)}</strong>
                {onSelectCabin && (
                  <Button variant={selectedCabinId === cabin.cabinId ? 'primary' : 'secondary'} disabled={soldOut || cancelled}
                    aria-pressed={selectedCabinId === cabin.cabinId} onClick={() => onSelectCabin(flight, cabin)}>
                    {selectedCabinId === cabin.cabinId ? 'Selected' : 'Select'}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
        {flight.cabins.length === 0 && <li className="text-sm text-muted">No cabins are available on this flight yet.</li>}
      </ul>
      {!hideDetailsLink && <Link href={`/flights/${flight.flightId}`} className="text-sm font-semibold">View flight details</Link>}
    </Card>
  );
}
