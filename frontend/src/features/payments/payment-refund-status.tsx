'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, apiClient } from '@/lib/api/client';
import { formatPaymentAmount, formatRefundAmount } from './money';
import { AMOUNT_MISMATCH_REASON } from './outcome';
import type { Payment, PaymentStatus, Refund, RefundStatus } from './types';

export interface PaymentRefundStatusProps {
  /** paymentId from the booking details (flight or hotel). */
  paymentId?: string;
  /** refundId from the booking details. */
  refundId?: string;
  /** Fallback only: each Payment and Refund carries its own currency, which is used when present. */
  currency?: string;
}

// Status is always spelled out next to the colour (GEN accessibility rule).
const paymentMeta: Record<PaymentStatus, { label: string; tone: BadgeTone; text: string }> = {
  PENDING: { label: 'Payment processing', tone: 'warning', text: 'Stripe has not confirmed this payment yet.' },
  SUCCEEDED: { label: 'Paid', tone: 'success', text: 'Stripe confirmed this payment.' },
  FAILED: { label: 'Payment failed', tone: 'danger', text: 'This payment did not go through.' },
  REFUNDED: { label: 'Payment refunded', tone: 'info', text: 'The whole payment was refunded.' },
};

// PAY-03 statuses, as agreed in the backend (Pending, Refunded, Failed).
const refundMeta: Record<RefundStatus, { label: string; tone: BadgeTone; text: string }> = {
  PENDING: { label: 'Refund pending', tone: 'warning', text: 'Your refund has been requested and is on its way.' },
  REFUNDED: { label: 'Refunded', tone: 'success', text: 'The refund was paid back to your original payment method.' },
  FAILED: { label: 'Refund failed', tone: 'danger', text: 'The refund did not go through. This status updates if it is sent again.' },
};

type Slot<T> = { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; message: string };

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return 'Not found.';
  if (error instanceof ApiError && error.status === 401) return 'Sign in again to see this status.';
  return 'Could not be loaded right now.';
}

function useDocument<T>(path: string | null, version: number): { slot: Slot<T>; checking: boolean } {
  const [slot, setSlot] = useState<{ path: string; version: number; value: Slot<T> } | null>(null);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void apiClient<T>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setSlot({ path, version, value: { kind: 'ok', data } }); })
      .catch(error => { if (!controller.signal.aborted) setSlot({ path, version, value: { kind: 'error', message: messageFor(error) } }); });
    return () => controller.abort();
  }, [path, version]);

  if (!path) return { slot: { kind: 'loading' }, checking: false }; // Not shown: there is nothing to load.
  if (!slot || slot.path !== path) return { slot: { kind: 'loading' }, checking: true };
  // While "Check again" runs, the last answer stays on screen instead of flashing to a spinner.
  return { slot: slot.value, checking: slot.version !== version };
}

/**
 * PAY-01/PAY-03: a booking's payment and refund, read from GET /api/payments/:id and GET /api/refunds/:id.
 * Both answers are the backend's own status (a PENDING one is re-checked with Stripe there). Amounts are
 * major units (dollars). For Ismail's flight and Osama's hotel booking pages.
 */
export function PaymentRefundStatus({ paymentId, refundId, currency }: PaymentRefundStatusProps) {
  const [version, setVersion] = useState(0);
  const payment = useDocument<Payment>(paymentId ? `/payments/${encodeURIComponent(paymentId)}` : null, version);
  const refund = useDocument<Refund>(refundId ? `/refunds/${encodeURIComponent(refundId)}` : null, version);
  const again = useCallback(() => setVersion(current => current + 1), []);

  return (
    <PaymentRefundStatusView
      payment={paymentId ? payment.slot : undefined}
      refund={refundId ? refund.slot : undefined}
      currency={currency}
      checking={payment.checking || refund.checking}
      onCheckAgain={again}
    />
  );
}

export type StatusSlot<T> = Slot<T>;

export interface PaymentRefundStatusViewProps {
  payment?: StatusSlot<Payment>;
  refund?: StatusSlot<Refund>;
  currency?: string;
  checking?: boolean;
  onCheckAgain?: () => void;
}

/** Presentation only (also used by the /dev/ui/payments gallery). PaymentRefundStatus does the loading. */
export function PaymentRefundStatusView({ payment, refund, currency, checking = false, onCheckAgain }: PaymentRefundStatusViewProps) {
  if (!payment && !refund) return <p className="m-0 text-sm text-muted">No payment yet.</p>;
  const withCurrency = <D extends { amount: number; currency: string }>(data: D) => ({ amount: data.amount, currency: data.currency || currency || 'USD' });

  return (
    <div className="grid gap-4" aria-busy={checking}>
      {payment && (
        <StatusRow
          title="Payment"
          slot={payment}
          meta={data => paymentMeta[data.status]}
          amount={data => formatPaymentAmount(withCurrency(data))}
          detail={data => data.status !== 'FAILED' || !data.failureReason ? undefined
            : data.failureReason === AMOUNT_MISMATCH_REASON ? 'An administrator is checking this payment. Please do not pay again.'
              : data.failureReason}
        />
      )}
      {refund && (
        <StatusRow title="Refund" slot={refund} meta={data => refundMeta[data.status]} amount={data => formatRefundAmount(withCurrency(data))} />
      )}
      {onCheckAgain && (
        <div>
          <Button variant="secondary" onClick={onCheckAgain} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</Button>
        </div>
      )}
    </div>
  );
}

function StatusRow<T>({ title, slot, meta, amount, detail }: {
  title: string;
  slot: Slot<T>;
  meta: (data: T) => { label: string; tone: BadgeTone; text: string };
  amount: (data: T) => string;
  detail?: (data: T) => string | undefined;
}) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="m-0 text-base">{title}</h3>
      {slot.kind === 'ok' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge tone={meta(slot.data).tone}>{meta(slot.data).label}</Badge>
            <span className="font-heading text-xl font-bold tabular-nums text-ink">{amount(slot.data)}</span>
          </div>
          <p className="m-0 text-sm text-muted">{detail?.(slot.data) ?? meta(slot.data).text}</p>
        </>
      ) : slot.kind === 'error' ? (
        <p role="alert" className="m-0 text-sm text-danger">{title} status: {slot.message}</p>
      ) : (
        <p role="status" className="m-0 text-sm text-muted">Loading {title.toLowerCase()} status…</p>
      )}
    </section>
  );
}
