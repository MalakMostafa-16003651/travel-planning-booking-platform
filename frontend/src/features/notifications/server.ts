import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import type { NotificationPage } from './types';

export type InboxResult = { kind: 'ok'; data: NotificationPage } | { kind: 'error'; message: string };

/** GEN-01: GET /api/notifications for the signed-in user, 10 per page. No session: sign in and return. */
export async function loadInbox(page: number, unreadOnly: boolean, returnTo: string): Promise<InboxResult> {
  const query = new URLSearchParams();
  if (page > 1) query.set('page', String(page));
  if (unreadOnly) query.set('unreadOnly', 'true');
  const jar = await cookies();
  let response: Response;
  try {
    response = await fetch(new URL(`/api/notifications${query.size ? `?${query}` : ''}`, backendUrl()), {
      headers: { Cookie: authCookies(jar.toString()) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { kind: 'error', message: 'Unable to reach the server. Try again in a moment.' };
  }
  if (response.status === 401) redirect(loginHref(returnTo));
  if (!response.ok) return { kind: 'error', message: 'Your notifications could not be loaded. Try again in a moment.' };
  return { kind: 'ok', data: await response.json() as NotificationPage };
}
