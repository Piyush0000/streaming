import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Stream } from '@streaming/shared-types';
import { useSession } from './SessionContext';
import { listLiveStreams } from '../lib/streams';
import GoLiveModal from '../components/GoLiveModal';

const POLL_MS = 15000;

interface LiveStreamsContextValue {
  streams: Stream[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Opens the Go-live flow (eligibility -> guidelines -> form) from anywhere in the app shell. */
  openGoLive: () => void;
}

const LiveStreamsContext = createContext<LiveStreamsContextValue | undefined>(undefined);

/** Polls GET /streams?status=live every ~15s and on window focus; also hosts the Go-live modal. */
export function LiveStreamsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const token = session?.accessToken;
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    try {
      setStreams(await listLiveStreams(token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const openGoLive = useCallback(() => setGoLiveOpen(true), []);

  const value = useMemo(
    () => ({ streams, loading, error, refresh, openGoLive }),
    [streams, loading, error, refresh, openGoLive]
  );

  return (
    <LiveStreamsContext.Provider value={value}>
      {children}
      {goLiveOpen && (
        <GoLiveModal
          onClose={() => {
            setGoLiveOpen(false);
            refresh();
          }}
        />
      )}
    </LiveStreamsContext.Provider>
  );
}

export function useLiveStreams(): LiveStreamsContextValue {
  const ctx = useContext(LiveStreamsContext);
  if (!ctx) throw new Error('useLiveStreams must be used within a LiveStreamsProvider');
  return ctx;
}
