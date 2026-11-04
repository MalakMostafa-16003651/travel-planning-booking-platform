export const BOOKING_NOTIFICATIONS = 'BOOKING_NOTIFICATIONS';

export interface BookingNotification {
  userId: string;
  type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED';
  message: string;
}

/** In-app notifications from the shared service (Person 2, GEN-01). */
export interface BookingNotificationsPort {
  notify(notification: BookingNotification): Promise<void>;
}
