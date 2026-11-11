import { ClientSession } from 'mongoose';
export const BOOKING_NOTIFICATIONS = 'BOOKING_NOTIFICATIONS';

export interface BookingNotification {
  userId: string;
  type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED';
  message: string;
  eventKey?: string;
}

/** In-app notifications from the shared service (Person 2, GEN-01). */
export interface BookingNotificationsPort {
  notify(notification: BookingNotification): Promise<void>;
  stage?(notification: BookingNotification, key: string, session: ClientSession): Promise<void>;
  deliver?(key: string): Promise<void>;
}
