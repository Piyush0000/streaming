import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sessionManager } from '../lib/sessionManager';
import type { Session } from '../lib/sessionCore';

export type { Session };

interface SessionContextValue {
  session: Session | null;
  /** True while we're still checking localStorage for a persisted session. */
  initializing: boolean;
  setSession: (session: Session | null) => void;
  /** Replace just the tokens (e.g. after a refresh); keeps the user. */
  updateTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  /** The CURRENT access token (unlike session.accessToken, never stale). */
  getAccessToken: () => string | null;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * React view of lib/sessionManager (the single source of truth).
 *
 * Identity-stable on purpose: when only the TOKENS rotate (proactive refresh, an
 * on-401 refresh, or another tab refreshing) the exposed `session` object is kept
 * as is. ~25 effects across the app list `session.accessToken` as a dependency
 * (stream page load, media join, chat socket, feeds...), and a new string every
 * ~14 minutes would reload the stream page and tear down the room mid-call.
 * The live token is always available via `getAccessToken()` (or the manager), the
 * fetch interceptor (lib/authFetch) substitutes it into every /api request, and
 * the sockets read it at (re)connect time - so a stale `session.accessToken` is
 * never what actually goes on the wire. Login / logout / user change replace the object.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => sessionManager.getSession());
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    setSessionState(sessionManager.getSession());
    setInitializing(false);
    const unsubscribe = sessionManager.subscribe((next) =>
      setSessionState((prev) => (prev && next && prev.user.id === next.user.id ? prev : next))
    );
    return unsubscribe;
  }, []);

  const setSession = useCallback((next: Session | null) => {
    if (next) sessionManager.setSession(next);
    else sessionManager.clear();
  }, []);

  const updateTokens = useCallback((tokens: { accessToken: string; refreshToken: string }) => {
    sessionManager.updateTokens(tokens);
  }, []);

  const logout = useCallback(() => sessionManager.clear(), []);
  const getAccessToken = useCallback(() => sessionManager.getAccessToken(), []);

  const value = useMemo(
    () => ({ session, initializing, setSession, updateTokens, getAccessToken, logout }),
    [session, initializing, setSession, updateTokens, getAccessToken, logout]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
