// Booking/provider prices are cents. Payments/refunds and itinerary budgets are major units.
// The endpoint DTO, not a property named "amount", determines which function to use.
export function formatMoneyMinorUnits(amount: number, currency = 'USD', locale = 'en-US'): string {
  if (!Number.isSafeInteger(amount)) throw new Error('Expected an integer minor-unit amount');
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
}
export function formatMoneyMajorUnits(amount: number, currency = 'USD', locale = 'en-US'): string {
  if (!Number.isFinite(amount)) throw new Error('Expected a finite major-unit amount');
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}
