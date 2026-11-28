// Mirrors backend/src/admin/dto/admin-booking-response.dto.ts (ACC-17) and
// backend/src/audit-logs/dto/audit-log-response.dto.ts (GEN-07).

export const BOOKING_TYPES = ['FLIGHT', 'HOTEL'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];
export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface AdminBooking {
  type: BookingType;
  bookingId: string;
  bookingReference?: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  providerId: string;
  providerName?: string;
  /** Departure (flights) or check-in date (hotels). */
  startDate: string;
  /** Check-out date, hotels only. */
  endDate?: string;
  /** Integer minor units (cents), per the team's amount table. */
  totalAmount: number;
  currency: string;
  status: BookingStatus;
}

export const AUDIT_ACTIONS = [
  'MODERATOR_CREATED', 'AIRLINE_CREATED', 'HOTEL_CREATED', 'PASSWORD_RESET', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED',
  'PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED', 'CONTENT_HIDDEN', 'CONTENT_UNHIDDEN', 'CONTENT_DELETED', 'REPORT_DISMISSED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGETS = ['USER', 'AIRLINE', 'HOTEL', 'POST', 'COMMENT', 'REVIEW', 'ITINERARY'] as const;
export type AuditTarget = (typeof AUDIT_TARGETS)[number];

export interface AuditEntry {
  auditLogId: string;
  adminId: string;
  adminName?: string;
  action: AuditAction;
  targetType: AuditTarget;
  targetId: string;
  details?: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const bookingStatusLabels: Record<BookingStatus, string> = {
  PENDING: 'Pending payment', CONFIRMED: 'Confirmed', COMPLETED: 'Completed', EXPIRED: 'Expired', CANCELLED: 'Cancelled',
};

export const auditActionLabels: Record<AuditAction, string> = {
  MODERATOR_CREATED: 'Moderator created', AIRLINE_CREATED: 'Airline created', HOTEL_CREATED: 'Hotel created',
  PASSWORD_RESET: 'Temporary password set', ACCOUNT_SUSPENDED: 'Account suspended', ACCOUNT_REACTIVATED: 'Account reactivated',
  PROVIDER_DEACTIVATED: 'Provider deactivated', PROVIDER_REACTIVATED: 'Provider reactivated', CONTENT_HIDDEN: 'Content hidden',
  CONTENT_UNHIDDEN: 'Content unhidden', CONTENT_DELETED: 'Content deleted', REPORT_DISMISSED: 'Report dismissed',
};

export const auditTargetLabels: Record<AuditTarget, string> = {
  USER: 'Account', AIRLINE: 'Airline', HOTEL: 'Hotel', POST: 'Post', COMMENT: 'Comment', REVIEW: 'Review', ITINERARY: 'Itinerary',
};
