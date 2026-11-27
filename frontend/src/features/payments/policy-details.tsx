import { formatMoneyMajorUnits } from '@/lib/format/money';
import type { CancellationTier, CheckoutType, Policies } from './types';

export interface PolicyDetailsProps {
  type: CheckoutType;
  policies: Policies;
  currency: string;
  /** Names an airline by its flights, since the policies only carry its id. */
  airlineLabels?: Record<string, string>;
}

function days(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** FLT-09/HTL rules: the tier with the highest threshold not above the days left applies, otherwise nothing. */
function tierLines(tiers: CancellationTier[], hotel: boolean): string[] {
  const event = hotel ? 'check-in' : 'departure';
  return tiers
    .map(tier => ({ days: (hotel ? tier.daysBeforeCheckIn : tier.daysBeforeDeparture) ?? 0, percent: tier.refundPercentage }))
    .sort((a, b) => b.days - a.days)
    .map(tier => tier.days === 0
      ? `Any time before ${event}: ${tier.percent}% back`
      : `${days(tier.days)} or more before ${event}: ${tier.percent}% back`);
}

/**
 * PAY-02: what the traveler accepts before paying, exactly as the backend returned it. Presentation only;
 * every amount in the policies response is in major units (dollars).
 */
export function PolicyDetails({ type, policies, currency, airlineLabels = {} }: PolicyDetailsProps) {
  const hotel = type === 'hotel';
  const rawTiers = policies.cancellation?.tiers ?? [];
  const tiers = tierLines(rawTiers, hotel);
  // Without a 0-day tier, cancelling late gives nothing back; say so instead of leaving it implied.
  const lateNote = rawTiers.length > 0 && rawTiers.every(tier => ((hotel ? tier.daysBeforeCheckIn : tier.daysBeforeDeparture) ?? 0) > 0);
  const baggage = policies.baggage ?? [];

  return (
    <div className="grid gap-5 text-sm">
      <section className="grid gap-1" aria-labelledby="policy-cancellation">
        <h3 id="policy-cancellation" className="m-0 text-base">If you cancel</h3>
        {tiers.length
          ? <ul className="m-0 grid list-disc gap-1 pl-5 text-body">{tiers.map(line => <li key={line}>{line}</li>)}</ul>
          : <p className="m-0 text-body">{hotel ? 'This hotel gives no refund for cancellations.' : 'This airline gives no refund for cancellations.'}</p>}
        {lateNote && <p className="m-0 text-muted">Later than that, there is no refund.</p>}
      </section>

      {!hotel && baggage.length > 0 && (
        <section className="grid gap-1" aria-labelledby="policy-baggage">
          <h3 id="policy-baggage" className="m-0 text-base">Extra baggage</h3>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-body">
            {baggage.map((rule, index) => (
              <li key={`${rule.airlineId}-${index}`}>
                {baggage.length > 1 || airlineLabels[rule.airlineId] ? `${airlineLabels[rule.airlineId] ?? `Airline ${index + 1}`}: ` : ''}
                {rule.maxExtraBagsPerPassenger > 0
                  ? `${formatMoneyMajorUnits(rule.pricePerExtraBag, currency)} per extra bag, up to ${rule.maxExtraBagsPerPassenger} per traveler`
                  : 'No extra bags'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hotel && policies.checkInOut && (
        <section className="grid gap-1" aria-labelledby="policy-times">
          <h3 id="policy-times" className="m-0 text-base">Check-in and check-out</h3>
          <p className="m-0 text-body">Check-in from {policies.checkInOut.checkInTime} · Check-out by {policies.checkInOut.checkOutTime} (hotel local time)</p>
        </section>
      )}

      {policies.change && (
        <section className="grid gap-1" aria-labelledby="policy-change">
          <h3 id="policy-change" className="m-0 text-base">Your change</h3>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
            <dt>Current fare</dt><dd className="m-0 text-right tabular-nums">{formatMoneyMajorUnits(policies.change.previousAmount, currency)}</dd>
            <dt>New fare</dt><dd className="m-0 text-right tabular-nums">{formatMoneyMajorUnits(policies.change.totalAmount, currency)}</dd>
            <dt className="font-semibold text-ink">Difference</dt><dd className="m-0 text-right font-semibold tabular-nums text-ink">{formatMoneyMajorUnits(policies.change.differenceAmount, currency)}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
