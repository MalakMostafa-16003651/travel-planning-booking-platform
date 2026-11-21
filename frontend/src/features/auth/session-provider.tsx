'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError, apiClient } from '@/lib/api/client';
import type { AuthenticatedUser } from '@/types/auth';

type Session = {
  user: AuthenticatedUser | null; loading: boolean; error: string | null;
  refresh: () => Promise<AuthenticatedUser | null>;
  clear: () => void;
};
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const requestVersion = useRef(0);
  const clear = useCallback(() => { requestVersion.current += 1; setUser(null); setError(null); setLoading(false); }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const current = await apiClient<AuthenticatedUser>('/auth/me');
      if (version !== requestVersion.current) return null;
      setUser(current); setError(null); return current;
    } catch (error) {
      if (version !== requestVersion.current) return null;
      setUser(null);
      if (error instanceof ApiError && error.status === 401) { setError(null); return null; }
      setError(error instanceof Error ? error.message : 'Unable to load session');
      return null;
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);
  useEffect(() => {
    const expire = clear;
    const focus = () => { void refresh(); };
    window.addEventListener('session-expired', expire);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('session-expired', expire); window.removeEventListener('focus', focus); };
  }, [refresh, clear]);
  return <SessionContext.Provider value={{ user, loading, error, refresh, clear }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession requires SessionProvider');
  return session;
}
