import { count, money } from './format';
import type { BookingSegment, PassengerSummary, PassengerType } from './types';

const INFANT_FARE_PERCENTAGE = 10; // FLT-12, as in the backend's flight-booking.rules.ts.

function farePerPassenger(fare: number, type: PassengerType): number {
  return type === 'INFANT' ? Math.round(fare * INFANT_FARE_PERCENTAGE / 100) : fare;
}

const nouns: Record<PassengerType, [string, string]> = { ADULT: ['adult', 'adults'], CHILD: ['child', 'children'], INFANT: ['infant', 'infants'] };

/**
 * The total always comes from the server. The lines above it only explain it, and they are left out if
 * they do not add up to exactly that total.
 */
export function FareSummary({ segments, passengers, baggageFee, totalAmount, currency, totalLabel = 'Total' }: {
  segments: Pick<BookingSegment, 'flightId' | 'flightNumber' | 'fare'>[];
  passengers: PassengerSummary[];
  baggageFee: number;
  totalAmount: number;
  currency: string;
  totalLabel?: string;
}) {
  const types = (['ADULT', 'CHILD', 'INFANT'] as const)
    .map(type => ({ type, amount: passengers.filter(passenger => passenger.type === type).length }))
    .filter(({ amount }) => amount > 0);
  const lines = segments.flatMap(segment => types.map(({ type, amount }) => ({
    key: `${segment.flightId}-${type}`,
    label: `${segment.flightNumber} · ${count(amount, ...nouns[type])}`,
    detail: `${money(farePerPassenger(segment.fare, type), currency)} each${type === 'INFANT' ? ', 10% of the fare' : ''}`,
    amount: amount * farePerPassenger(segment.fare, type),
  })));
  const explained = lines.reduce((sum, line) => sum + line.amount, 0) + baggageFee === totalAmount;
  const bags = passengers.reduce((sum, passenger) => sum + passenger.extraBags, 0);

  return (
    <dl className="m-0 grid gap-3">
      {explained && lines.map(line => (
        <div key={line.key} className="flex items-start justify-between gap-4 text-sm">
          <dt className="min-w-0">
            <span className="text-body">{line.label}</span>
            <span className="block text-xs text-muted">{line.detail}</span>
          </dt>
          <dd className="m-0 shrink-0 tabular-nums text-ink">{money(line.amount, currency)}</dd>
        </div>
      ))}
      {baggageFee > 0 && (
        <div className="flex items-start justify-between gap-4 text-sm">
          <dt>Extra baggage<span className="block text-xs text-muted">{count(bags, 'bag')}</span></dt>
          <dd className="m-0 shrink-0 tabular-nums text-ink">{money(baggageFee, currency)}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <dt className="font-semibold text-ink">{totalLabel}</dt>
        <dd className="m-0 font-heading text-2xl font-bold tabular-nums text-ink">{money(totalAmount, currency)}</dd>
      </div>
    </dl>
  );
}
