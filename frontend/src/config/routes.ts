import type { UserRole } from '@/types/auth';

export const roleWorkspaces: Record<UserRole, string> = {
  USER: '/workspace/traveler',
  ADMIN: '/workspace/admin',
  AIRLINE_MODERATOR: '/workspace/airline',
  HOTEL_MODERATOR: '/moderator/hotel',
};
export const workspaceRoles: Record<string, UserRole | undefined> = {
  traveler: 'USER', admin: 'ADMIN', airline: 'AIRLINE_MODERATOR', hotel: 'HOTEL_MODERATOR',
};

export const roleLabels: Record<UserRole, string> = {
  USER: 'Traveler', ADMIN: 'Administrator', AIRLINE_MODERATOR: 'Airline moderator', HOTEL_MODERATOR: 'Hotel moderator',
};

const authOrApi = /^\/(api|login|register|forgot-password|reset-password)(\/|$)/iu;

// Keep booking filters and trip context in the query while validating the destination path.
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/u.test(value)) return null;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    const decoded = decodeURIComponent(parsed.pathname);
    if (parsed.origin !== 'https://local.invalid' || decoded.startsWith('//') ||
      /[\\\u0000-\u001f\u007f]/u.test(decoded) || authOrApi.test(decoded)) return null;
    const normalized = new URL(decoded, parsed.origin);
    if (normalized.origin !== parsed.origin || authOrApi.test(normalized.pathname)) return null;
    // Verification status is a valid sign-in destination, but email proofs stay out of return URLs.
    if (/^\/verify-email\/?$/iu.test(normalized.pathname) && (parsed.hash || parsed.searchParams.has('token'))) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}

export function loginHref(returnTo?: string | null, status: Record<string, string> = {}): string {
  const query = new URLSearchParams(status);
  const target = safeReturnPath(returnTo);
  if (target) query.set('returnTo', target);
  return query.size ? `/login?${query}` : '/login';
}
