/** Team agreement: PENDING, SUCCEEDED, FAILED, REFUNDED. */
export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED', // Only when the whole amount came back; partial refunds stay SUCCEEDED.
}

/** PAY-03 sheet values (Pending, Refunded, Failed), agreed on 2026-11-06 instead of SUCCEEDED. */
export enum RefundStatus {
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}
