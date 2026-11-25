// Mirrors backend/src/reports (GEN-09, GEN-10).

export const REPORT_STATUSES = ['OPEN', 'RESOLVING', 'DISMISSED', 'CONTENT_HIDDEN', 'CONTENT_DELETED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const TARGET_TYPES = ['POST', 'COMMENT', 'REVIEW', 'ITINERARY'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** Lower-case names used in /api/admin/content/:type/:id. */
export type ContentType = 'post' | 'comment' | 'review' | 'itinerary';

export interface AdminReport {
  reportId: string;
  userId: string;
  userName?: string;
  targetType: TargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ReportPage {
  items: AdminReport[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ModerationResult {
  type: ContentType;
  id: string;
  state: 'HIDDEN' | 'VISIBLE' | 'DELETED';
  closedReports: number;
}

export const reportStatusLabels: Record<ReportStatus, string> = {
  OPEN: 'Open',
  RESOLVING: 'Being resolved',
  DISMISSED: 'Dismissed',
  CONTENT_HIDDEN: 'Content hidden',
  CONTENT_DELETED: 'Content deleted',
};

export const targetTypeLabels: Record<TargetType, string> = { POST: 'Post', COMMENT: 'Comment', REVIEW: 'Review', ITINERARY: 'Itinerary' };

export const isObjectId = (value: string) => /^[a-f\d]{24}$/i.test(value);
