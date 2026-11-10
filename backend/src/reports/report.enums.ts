/** GEN-09: the kinds of content a registered user can report. */
export enum ReportTargetType {
  POST = 'POST',
  COMMENT = 'COMMENT',
  REVIEW = 'REVIEW',
  ITINERARY = 'ITINERARY',
}

/** GEN-10: a report is OPEN until an admin dismisses it or hides/deletes the content. */
export enum ReportStatus {
  OPEN = 'OPEN',
  DISMISSED = 'DISMISSED',
  CONTENT_HIDDEN = 'CONTENT_HIDDEN',
  CONTENT_DELETED = 'CONTENT_DELETED',
}

/** GEN-10: how an admin resolves a report. */
export enum ReportAction {
  DISMISS = 'DISMISS',
  HIDE = 'HIDE',
  DELETE = 'DELETE',
}

/** Lower-case content types used in /api/admin/content/:type/:id. */
export const CONTENT_TYPES = ['post', 'comment', 'review', 'itinerary'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export function toTargetType(type: ContentType): ReportTargetType {
  return type.toUpperCase() as ReportTargetType;
}
