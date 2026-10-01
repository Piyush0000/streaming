import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../lib/api';

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface SessionContextValue {
  session: Session | null;
  /** True while we're still checking localStorage for a persisted session. */
  initializing: boolean;
  setSession: (session: Session | null) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const STORAGE_KEY = 'streaming.session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSessionState(JSON.parse(raw));
    } catch {
      // ignore malformed/inaccessible storage
    } finally {
      setInitializing(false);
    }
  }, []);

  function setSession(next: Session | null) {
    setSessionState(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures (private browsing, quota, etc.)
    }
  }

  function logout() {
    setSession(null);
  }

  const value = useMemo(
    () => ({ session, initializing, setSession, logout }),
    [session, initializing]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
