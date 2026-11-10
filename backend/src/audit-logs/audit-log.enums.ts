/** GEN-07: admin actions that must be auditable. Agreed in docs/requirements/admin-contract-proposal.md. */
export enum AuditAction {
  MODERATOR_CREATED = 'MODERATOR_CREATED',
  /** For Person 3: an admin creates an airline (FLT-01). */
  AIRLINE_CREATED = 'AIRLINE_CREATED',
  /** For Person 5: an admin creates a hotel (HTL-01). */
  HOTEL_CREATED = 'HOTEL_CREATED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  PROVIDER_DEACTIVATED = 'PROVIDER_DEACTIVATED',
  PROVIDER_REACTIVATED = 'PROVIDER_REACTIVATED',
  CONTENT_HIDDEN = 'CONTENT_HIDDEN',
  CONTENT_UNHIDDEN = 'CONTENT_UNHIDDEN',
  CONTENT_DELETED = 'CONTENT_DELETED',
  REPORT_DISMISSED = 'REPORT_DISMISSED',
}

/** The kind of record an admin action affected. */
export enum AuditTargetType {
  USER = 'USER',
  AIRLINE = 'AIRLINE',
  HOTEL = 'HOTEL',
  POST = 'POST',
  COMMENT = 'COMMENT',
  REVIEW = 'REVIEW',
  ITINERARY = 'ITINERARY',
  REPORT = 'REPORT',
}
