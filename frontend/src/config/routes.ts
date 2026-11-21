import type { UserRole } from '@/types/auth';

export const roleWorkspaces: Record<UserRole, string> = {
  USER: '/workspace/traveler',
  ADMIN: '/workspace/admin',
  AIRLINE_MODERATOR: '/workspace/airline',
  HOTEL_MODERATOR: '/workspace/hotel',
};
export const workspaceRoles: Record<string, UserRole | undefined> = {
  traveler: 'USER', admin: 'ADMIN', airline: 'AIRLINE_MODERATOR', hotel: 'HOTEL_MODERATOR',
};

// Accept only a local path, including when a malicious URL is encoded or uses backslashes.
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/u.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u0020]/u.test(decoded)) return null;
    const parsed = new URL(value, 'https://local.invalid');
    if (parsed.origin !== 'https://local.invalid' || /^\/(login|api)(\/|$)/u.test(parsed.pathname)) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}
