'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session-provider';
import { apiClient } from '@/lib/api/client';
import { NOTIFICATIONS_CHANGED } from './types';

/**
 * GEN-01 unread bell for every signed-in role, mounted once in the header's notificationSlot.
 * The count is read on sign-in, on navigation, when the window regains focus and after the inbox
 * changes. There is no timer: polling would keep an idle session alive (see frontend/README.md).
 */
export function NotificationBell() {
  const { user } = useSession();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const latest = useRef(0);
  const userId = user?.userId;

  const load = useCallback(async () => {
    if (!userId) return;
    const request = ++latest.current;
    try {
      const { unreadCount } = await apiClient<{ unreadCount: number }>('/notifications/unread-count');
      if (request === latest.current) setUnread(unreadCount);
    } catch {
      // Keep the last known count; the inbox page shows the full error if the user opens it.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) { latest.current += 1; setUnread(null); return; }
    void load();
  }, [userId, pathname, load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener(NOTIFICATIONS_CHANGED, refresh); };
  }, [load]);

  if (!user) return null;

  const count = unread ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';
  const active = pathname === '/notifications';

  return (
    <Link
      href="/notifications"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className="relative inline-flex size-11 items-center justify-center rounded-control border border-ink bg-card text-ink no-underline hover:bg-canvas"
    >
      <Bell size={20} aria-hidden="true" />
      {count > 0 && (
        <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-xs font-semibold leading-5 text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
