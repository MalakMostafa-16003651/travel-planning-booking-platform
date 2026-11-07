// One rounding rule for every Payments amount (major units, 2 decimals).
// EPSILON avoids float surprises such as 1.005 -> 1.00.
// Assumes 2-decimal currencies, like the platform currency (PAY-04).
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Stripe and the booking modules work in minor units (cents, piasters). */
export function toMinorUnits(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}
