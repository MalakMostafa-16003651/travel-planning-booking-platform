import 'server-only';
import { cookies } from 'next/headers';
import type { AuthenticatedUser } from '@/types/auth';
import { authCookies, backendUrl } from './upstream';

// For future Server Components: explicit cookie forwarding, never shared caching.
export async function getServerSession(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  const response = await fetch(new URL('/api/auth/me', backendUrl()), {
    headers: { Cookie: authCookies(jar.toString()) }, cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Unable to load the current session');
  return response.json() as Promise<AuthenticatedUser>;
}
