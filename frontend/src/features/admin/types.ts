// Mirrors backend/src/admin/dto/account-response.dto.ts (GET /api/admin/accounts, ACC-14).
import type { AccountStatus, UserRole } from '@/types/auth';

export const USER_ROLES = ['USER', 'ADMIN', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const satisfies readonly UserRole[];
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const satisfies readonly AccountStatus[];

export interface AdminAccount {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  /** Registration date, ISO string. */
  createdAt: string;
}

export interface AdminAccountPage {
  items: AdminAccount[];
  page: number;
  pageSize: number;
  total: number;
  /** 0 when there are no results. */
  totalPages: number;
}

export interface AccountFilters {
  page: number;
  search?: string;
  role?: UserRole;
  status?: AccountStatus;
}

/** Outcome of a server read, so pages can show the right state instead of throwing. */
export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'forbidden' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };
