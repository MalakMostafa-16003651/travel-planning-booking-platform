'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { apiClient } from '@/lib/api/client';
import { count, money } from './format';
import { RequestError } from './request-error';
import type { CancellationQuote, FlightBooking } from './types';

/** FLT-26: the refund is shown first, then confirmed once. The server decides the final amount. */
export function CancelBooking({ bookingId, roundTrip }: { bookingId: string; roundTrip: boolean }) {
  const router = useRouter();
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const result = useRef<HTMLDivElement>(null);

  async function loadQuote() {
    setLoading(true);
    setError(null);
    try {
      setQuote(await apiClient<CancellationQuote>(`/flight-bookings/${bookingId}/cancellation-quote`));
      requestAnimationFrame(() => result.current?.focus());
    } catch (cause) {
      setError(cause);
      router.refresh(); // The booking may have departed or been cancelled in the meantime.
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    await apiClient<FlightBooking>(`/flight-bookings/${bookingId}/cancel`, { method: 'POST' });
    router.refresh();
  }

  return (
    <section aria-labelledby="cancel-heading" className="grid gap-4">
      <div>
        <h2 id="cancel-heading" className="m-0">Cancel this booking</h2>
        <p className="m-0 mt-2 text-sm text-muted">
          {roundTrip ? 'Both flights are cancelled together, using the outbound flight’s refund rules.' : 'You can cancel any time before departure.'} Check your refund before you decide.
        </p>
      </div>
      {error != null && <RequestError error={error} title="Your refund could not be checked" />}
      {quote && (
        <div ref={result} tabIndex={-1} role="status" className="grid gap-3 rounded-control border border-border bg-canvas p-4 outline-none">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-sm text-body">Your refund if you cancel now</span>
            <span className="font-heading text-2xl font-bold tabular-nums text-ink">{money(quote.refundAmount, quote.currency)}</span>
          </div>
          <p className="m-0 text-sm text-muted">
            {quote.refundPercentage}% of {money(quote.totalAmount, quote.currency)}, with {count(quote.daysBeforeDeparture, 'full day')} left before departure.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {quote ? (
          <>
            <ConfirmDialog
              triggerLabel="Cancel booking"
              title="Cancel this booking?"
              description={quote.refundAmount > 0
                ? `You get ${money(quote.refundAmount, quote.currency)} back to your original payment method. Your seats are released and this cannot be undone.`
                : 'You get no refund. Your seats are released and this cannot be undone.'}
              confirmLabel="Yes, cancel booking"
              pendingLabel="Cancelling…"
              cancelLabel="Keep booking"
              onConfirm={cancel}
            />
            <Button variant="secondary" onClick={() => setQuote(null)}>Keep booking</Button>
          </>
        ) : (
          <Button variant="secondary" disabled={loading} onClick={loadQuote}>{loading ? 'Checking…' : 'Check my refund'}</Button>
        )}
      </div>
    </section>
  );
}
