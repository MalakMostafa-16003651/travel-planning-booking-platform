import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import { getServerSession } from '@/lib/api/server-session';
import type { AuthenticatedUser } from '@/types/auth';
import type { ReportPage, ReportStatus, TargetType } from './moderation-types';
import type { AccountFilters, AdminAccountPage, Loaded } from './types';

/**
 * Every admin page starts here. No session: sign in and come back. Another role: null, so the page
 * shows "Access denied". The backend's RolesGuard stays the real check on every request.
 */
export async function requireAdmin(returnTo: string): Promise<AuthenticatedUser | null> {
  const user = await getServerSession();
  if (!user) redirect(loginHref(returnTo));
  return user.role === 'ADMIN' ? user : null;
}

async function adminGet<T>(path: string, returnTo: string): Promise<Loaded<T>> {
  const jar = await cookies();
  let response: Response;
  try {
    response = await fetch(new URL(path, backendUrl()), {
      headers: { Cookie: authCookies(jar.toString()) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { kind: 'error', message: 'Unable to reach the server. Try again in a moment.' };
  }
  if (response.status === 401) redirect(loginHref(returnTo));
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 400) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    return { kind: 'invalid', message: body?.message || 'Those filters are not valid.' };
  }
  if (!response.ok) return { kind: 'error', message: 'The list could not be loaded. Try again in a moment.' };
  return { kind: 'ok', data: await response.json() as T };
}

/** ACC-14: GET /api/admin/accounts, newest first, 10 per page, with search/role/status filters. */
export function loadAccounts(filters: AccountFilters, returnTo: string): Promise<Loaded<AdminAccountPage>> {
  const query = new URLSearchParams();
  if (filters.page > 1) query.set('page', String(filters.page));
  if (filters.search) query.set('search', filters.search);
  if (filters.role) query.set('role', filters.role);
  if (filters.status) query.set('status', filters.status);
  return adminGet<AdminAccountPage>(`/api/admin/accounts${query.size ? `?${query}` : ''}`, returnTo);
}

/** GEN-10: GET /api/admin/reports, OPEN by default, newest first, 10 per page. */
export function loadReports(filters: { page: number; status?: ReportStatus; targetType?: TargetType }, returnTo: string): Promise<Loaded<ReportPage>> {
  const query = new URLSearchParams();
  if (filters.page > 1) query.set('page', String(filters.page));
  if (filters.status) query.set('status', filters.status);
  if (filters.targetType) query.set('targetType', filters.targetType);
  return adminGet<ReportPage>(`/api/admin/reports${query.size ? `?${query}` : ''}`, returnTo);
}
