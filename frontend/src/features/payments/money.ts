import { formatMoneyMajorUnits, formatMoneyMinorUnits } from '@/lib/format/money';
import type { BookingPolicies, Payment, Refund } from './types';

// PAY-04: endpoint-specific money adapters. The backend uses two units, and a field called "amount"
// does not say which one it is: the endpoint does. This map is the single place that records it,
// checked against the backend DTOs and services (see docs/m2/ROUTES_AND_HANDOFFS.md and docs/m2/PAYMENTS.md).
// 'minor' = integer cents (15050 = $150.50). 'major' = dollars (150.5 = $150.50). Never convert twice.

export type MoneyUnit = 'minor' | 'major';

export const MONEY_FIELDS = {
  // Payments (backend/src/payments): Stripe is charged amount x 100.
  'GET /api/payments/:id': { amount: 'major' },
  'POST /api/payments': { 'payment.amount': 'major' },
  'POST /api/payments/:id/retry': { 'payment.amount': 'major' },
  'GET /api/refunds/:id': { amount: 'major' },
  'GET /api/bookings/:type/:id/policies': {
    amount: 'major',
    'policies.baggage[].pricePerExtraBag': 'major',
    'policies.change.previousAmount': 'major',
    'policies.change.totalAmount': 'major',
    'policies.change.differenceAmount': 'major',
  },
  // Flight bookings (Ismail): every amount is cents, including the embedded refund.
  'GET /api/flight-bookings/:id': { totalAmount: 'minor', baggageFee: 'minor', 'segments[].fare': 'minor', refundAmount: 'minor', 'refund.amount': 'minor' },
  'GET /api/flight-booking-changes/:id': { previousAmount: 'minor', totalAmount: 'minor', differenceAmount: 'minor', amountToPay: 'minor', refundAmount: 'minor', 'refund.amount': 'minor' },
  // Hotel bookings (Osama): cents as well.
  'GET /api/hotel-bookings/:id': { totalPrice: 'minor', 'rooms[].pricePerNight': 'minor', 'rooms[].subtotal': 'minor', refundAmount: 'minor' },
} as const satisfies Record<string, Record<string, MoneyUnit>>;

/** Formats a value whose unit is known from MONEY_FIELDS. */
export function formatMoney(value: number, unit: MoneyUnit, currency = 'USD'): string {
  return unit === 'minor' ? formatMoneyMinorUnits(value, currency) : formatMoneyMajorUnits(value, currency);
}

/** Payment documents are in dollars. */
export function formatPaymentAmount(payment: Pick<Payment, 'amount' | 'currency'>): string {
  return formatMoneyMajorUnits(payment.amount, payment.currency);
}

/** Refund documents are in dollars, unlike the refund embedded in a booking. */
export function formatRefundAmount(refund: Pick<Refund, 'amount' | 'currency'>): string {
  return formatMoneyMajorUnits(refund.amount, refund.currency);
}

/** The amount checkout will charge: the policies response's top-level amount, in dollars. */
export function formatPolicyAmount(policies: Pick<BookingPolicies, 'amount' | 'currency'>): string {
  return formatMoneyMajorUnits(policies.amount, policies.currency);
}

/** Any booking or change amount (totalAmount, totalPrice, refundAmount, refund.amount...), in cents. */
export function formatBookingCents(value: number, currency = 'USD'): string {
  return formatMoneyMinorUnits(value, currency);
}
