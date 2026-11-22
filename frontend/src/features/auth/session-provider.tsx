'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError, apiClient } from '@/lib/api/client';
import type { AuthenticatedUser } from '@/types/auth';

type Session = {
  user: AuthenticatedUser | null; loading: boolean; error: string | null;
  ended: boolean;
  refresh: () => Promise<AuthenticatedUser | null>;
  clear: () => void;
};
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const pathname = usePathname();
  const requestVersion = useRef(0);
  const identity = useRef<AuthenticatedUser | null>(null);
  const inFlight = useRef<number | null>(null);
  const clear = useCallback(() => {
    requestVersion.current += 1;
    identity.current = null;
    inFlight.current = null;
    setUser(null);
    setError(null);
    setEnded(false);
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    inFlight.current = version;
    if (!identity.current) setLoading(true);
    try {
      const current = await apiClient<AuthenticatedUser>('/auth/me');
      if (version !== requestVersion.current) return null;
      identity.current = current;
      setUser(current);
      setError(null);
      setEnded(false);
      return current;
    } catch (error) {
      if (version !== requestVersion.current) return null;
      if (error instanceof ApiError && error.status === 401) {
        if (identity.current) setEnded(true);
        identity.current = null;
        setUser(null);
        setError(null);
        return null;
      }
      if (!identity.current) setError(error instanceof Error ? error.message : 'Unable to load session');
      return null;
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (inFlight.current === null) void refresh();
  }, [refresh, pathname]);
  useEffect(() => {
    const expire = () => {
      const wasSignedIn = !!identity.current;
      clear();
      if (wasSignedIn) setEnded(true);
    };
    const focus = () => {
      if (inFlight.current === null) void refresh();
    };
    window.addEventListener('session-expired', expire);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('session-expired', expire); window.removeEventListener('focus', focus); };
  }, [refresh, clear]);
  return <SessionContext.Provider value={{ user, loading, error, ended, refresh, clear }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession requires SessionProvider');
  return session;
}
