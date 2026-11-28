// Mirrors backend/src/notifications/dto/notification-response.dto.ts (GEN-01).

export type NotificationType =
  | 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'REFUND_ISSUED' | 'FLIGHT_SCHEDULE_CHANGED'
  | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_REACTIVATED' | 'PROVIDER_DEACTIVATED' | 'PROVIDER_REACTIVATED';

export interface AppNotification {
  notificationId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Unread in the whole inbox, not just this page. */
  unreadCount: number;
}

export const notificationTypeLabels: Record<NotificationType, string> = {
  BOOKING_CONFIRMED: 'Booking confirmed',
  BOOKING_CANCELLED: 'Booking cancelled',
  REFUND_ISSUED: 'Refund',
  FLIGHT_SCHEDULE_CHANGED: 'Flight schedule change',
  ACCOUNT_SUSPENDED: 'Account suspended',
  ACCOUNT_REACTIVATED: 'Account reactivated',
  PROVIDER_DEACTIVATED: 'Provider deactivated',
  PROVIDER_REACTIVATED: 'Provider reactivated',
};

/** Fired in the browser after the inbox changes, so the bell re-reads its count. */
export const NOTIFICATIONS_CHANGED = 'notifications-changed';
