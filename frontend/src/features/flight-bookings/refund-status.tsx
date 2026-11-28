import { Badge, type BadgeTone } from '@/components/ui/badge';
import { money } from './format';
import type { RefundStatus } from './types';

const meta: Record<RefundStatus['status'], { label: string; tone: BadgeTone; text: string }> = {
  PENDING: { label: 'Refund pending', tone: 'warning', text: 'Your refund has been requested and is on its way.' },
  REFUNDED: { label: 'Refunded', tone: 'success', text: 'Your refund has been paid back to your original payment method.' },
  FAILED: { label: 'Refund failed', tone: 'danger', text: 'The refund did not go through. Keep your booking reference; this status updates if the refund is sent again.' },
};

/**
 * PAY-03 for a cancelled booking, read from the booking itself. A cancellation after a paid fare
 * difference refunds two charges, and the booking's refund is their total, while Hicham's
 * PaymentRefundStatus shows one Refund record. It is also shown before the refund record exists
 * (a retry is due). Amounts are minor units.
 */
export function RefundSummary({ refund, refundAmount, currency }: { refund?: RefundStatus; refundAmount?: number; currency: string }) {
  if (!refund && !refundAmount) return <p className="m-0 text-sm text-muted">No refund applies to this booking.</p>;
  const state = refund ? meta[refund.status] : null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {state ? <Badge tone={state.tone}>{state.label}</Badge> : <Badge tone="warning">Refund being requested</Badge>}
        <span className="font-heading text-xl font-bold tabular-nums text-ink">{money(refund?.amount ?? refundAmount ?? 0, refund?.currency ?? currency)}</span>
      </div>
      <p className="m-0 text-sm text-muted">{state?.text ?? 'We are sending your refund to the payment provider. Its status will appear here.'}</p>
    </div>
  );
}
