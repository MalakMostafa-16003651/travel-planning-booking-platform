import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { PaymentRefundStatusView, type StatusSlot } from '@/features/payments/payment-refund-status';
import { PolicyDetails } from '@/features/payments/policy-details';
import type { Payment, Policies, Refund } from '@/features/payments/types';

export const dynamic = 'force-dynamic';

// Static examples only: this page never calls the API. Amounts are major units, as the endpoints return them.
const at = '2026-11-25T10:00:00.000Z';
const payment = (status: Payment['status'], failureReason?: string): StatusSlot<Payment> => ({
  kind: 'ok',
  data: { _id: '665f1c2b9d3e4a0012345678', bookingType: 'flight', amount: 225, currency: 'USD', status, failureReason, createdAt: at, updatedAt: at },
});
const refund = (status: Refund['status']): StatusSlot<Refund> => ({
  kind: 'ok',
  data: { _id: '665f1c2b9d3e4a0012345699', paymentId: '665f1c2b9d3e4a0012345678', amount: 112.5, currency: 'USD', status, createdAt: at, updatedAt: at },
});

const examples: { title: string; payment?: StatusSlot<Payment>; refund?: StatusSlot<Refund> }[] = [
  { title: 'No payment yet' },
  { title: 'Loading', payment: { kind: 'loading' } },
  { title: 'Processing', payment: payment('PENDING') },
  { title: 'Paid', payment: payment('SUCCEEDED') },
  { title: 'Failed', payment: payment('FAILED', 'Your card was declined.') },
  { title: 'Paid, refund pending', payment: payment('SUCCEEDED'), refund: refund('PENDING') },
  { title: 'Fully refunded', payment: payment('REFUNDED'), refund: refund('REFUNDED') },
  { title: 'Refund failed', payment: payment('SUCCEEDED'), refund: refund('FAILED') },
  { title: 'Could not load', payment: { kind: 'error', message: 'Could not be loaded right now.' } },
];

const flightPolicies: Policies = {
  cancellation: { tiers: [{ daysBeforeDeparture: 0, refundPercentage: 10 }, { daysBeforeDeparture: 7, refundPercentage: 50 }, { daysBeforeDeparture: 21, refundPercentage: 100 }] },
  baggage: [{ airlineId: 'a1', pricePerExtraBag: 30, maxExtraBagsPerPassenger: 2 }, { airlineId: 'a2', pricePerExtraBag: 0, maxExtraBagsPerPassenger: 0 }],
};
const hotelPolicies: Policies = {
  cancellation: { tiers: [{ daysBeforeCheckIn: 14, refundPercentage: 100 }, { daysBeforeCheckIn: 3, refundPercentage: 50 }] },
  checkInOut: { checkInTime: '14:00', checkOutTime: '11:00' },
};
const changePolicies: Policies = {
  ...flightPolicies,
  baggage: [{ airlineId: 'a1', pricePerExtraBag: 30, maxExtraBagsPerPassenger: 2 }],
  change: { previousAmount: 150, totalAmount: 210, differenceAmount: 60 },
};

/** Development-only examples of the payment components (Hicham), for Ismail and Osama. */
export default function PaymentsGalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <div className="stack">
      <div><p className="eyebrow">Development only</p><h1 className="m-0">Payment components</h1></div>
      <Card className="stack">
        <h2 className="m-0">PaymentRefundStatus</h2>
        <p className="m-0 text-sm text-muted">
          {'<PaymentRefundStatus paymentId={booking.paymentId} refundId={booking.refundId} />'} from @/features/payments. Shown here through
          PaymentRefundStatusView with fixed data.
        </p>
        <div className="gallery-grid">
          {examples.map(example => (
            <div key={example.title} className="grid gap-3 rounded-control border border-border p-4">
              <p className="m-0 text-sm font-semibold text-ink">{example.title}</p>
              <PaymentRefundStatusView payment={example.payment} refund={example.refund} />
            </div>
          ))}
        </div>
      </Card>
      <Card className="stack">
        <h2 className="m-0">PolicyDetails (PAY-02)</h2>
        <div className="gallery-grid">
          <div className="grid gap-3"><p className="m-0 text-sm font-semibold text-ink">Flight, two airlines</p>
            <PolicyDetails type="flight" policies={flightPolicies} currency="USD" airlineLabels={{ a1: 'Airline of MS1234', a2: 'Airline of EK920' }} /></div>
          <div className="grid gap-3"><p className="m-0 text-sm font-semibold text-ink">Hotel</p>
            <PolicyDetails type="hotel" policies={hotelPolicies} currency="USD" /></div>
          <div className="grid gap-3"><p className="m-0 text-sm font-semibold text-ink">Flight change, higher fare</p>
            <PolicyDetails type="flight-change" policies={changePolicies} currency="USD" /></div>
        </div>
      </Card>
    </div>
  );
}
