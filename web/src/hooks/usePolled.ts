import { useCallback, useEffect, useRef, useState } from 'react';
import { nextPollDelay } from '../lib/marketMath';

export interface Polled<T> {
  data: T | null;
  error: string | null;
  /** true until the first response (success or failure) arrives */
  loading: boolean;
  reload: () => void;
}

/**
 * Polls `fn` every `baseMs` while `enabled` and the tab is visible; backs off
 * exponentially on consecutive failures; fetches immediately when the tab
 * becomes visible again. Keeps the last good data on error.
 */
export function usePolled<T>(fn: (signal: AbortSignal) => Promise<T>, baseMs: number, enabled = true): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let failures = 0;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;

    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(run, nextPollDelay(baseMs, failures));
    };
    const run = async () => {
      window.clearTimeout(timer);
      if (cancelled || document.hidden) return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const next = await fnRef.current(ctrl.signal);
        if (cancelled) return;
        failures = 0;
        setData(next);
        setError(null);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        failures += 1;
        setError(err instanceof Error ? err.message : 'Request failed');
      }
      if (cancelled) return;
      setLoading(false);
      schedule();
    };
    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else void run();
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [baseMs, enabled, tick]);

  const reload = useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
  }, []);
  return { data, error, loading, reload };
}
