import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '@streaming/shared-types';
import { listChannels } from '../lib/api';
import { useSession } from './SessionContext';

/** Re-fetch on focus/visibility only if the list is older than this. */
const STALE_MS = 20_000;

interface ChannelsContextValue {
  channels: Channel[];
  loading: boolean;
  error: string | null;
  /** Re-fetches GET /channels. Call after anything that changes the list (create, delete, join, leave, removal). */
  refresh: () => Promise<void>;
}

const ChannelsContext = createContext<ChannelsContextValue | undefined>(undefined);

/**
 * Single source of truth for the sidebar's channel list. Any component can call
 * `refresh()` after a mutation; the list also re-syncs when the tab regains
 * focus (so removals/deletes made elsewhere show up without a reload).
 */
export function ChannelsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const token = session?.accessToken;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef(0);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    const seq = ++requestSeq.current;
    try {
      const list = await listChannels(token);
      if (seq !== requestSeq.current) return; // a newer refresh superseded this one
      setChannels(list);
      setError(null);
      lastFetch.current = Date.now();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = (err as Error).message;
      // Auth failures are handled centrally (lib/sessionManager: refresh, or one friendly sign-out).
      setError(message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > STALE_MS) void refresh();
    };
    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [refresh]);

  const value = useMemo(() => ({ channels, loading, error, refresh }), [channels, loading, error, refresh]);
  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>;
}

export function useChannels(): ChannelsContextValue {
  const ctx = useContext(ChannelsContext);
  if (!ctx) throw new Error('useChannels must be used within a ChannelsProvider');
  return ctx;
}
