/** GEN-11 lifecycle, shared by flight bookings and hotel reservations. */
export enum BookingStatus {
  PENDING = 'PENDING', // GEN-11 "Pending Payment"
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}
