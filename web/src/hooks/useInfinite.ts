import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../lib/hub';

/**
 * Cursor pagination + IntersectionObserver infinite scroll.
 * `fetchPage` must be stable per "query"; change `resetKey` to start over. `enabled=false` defers loading.
 */
export function useInfinite<T extends { id: string }>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  resetKey: string,
  enabled = true,
  onError?: (message: string) => void
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const gen = useRef(0);
  const inflight = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const errRef = useRef(onError);
  errRef.current = onError;
  const sentinel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (from: string | null) => {
    if (inflight.current) return;
    inflight.current = true;
    const mine = gen.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchRef.current(from);
      if (mine !== gen.current) return;
      setItems((prev) => (from ? [...prev, ...res.items.filter((x) => !prev.some((p) => p.id === x.id))] : res.items));
      setCursor(res.nextCursor);
      setDone(!res.nextCursor);
    } catch (err) {
      if (mine !== gen.current) return;
      setFailed(true);
      errRef.current?.(err instanceof Error ? err.message : 'Could not load.');
    } finally {
      if (mine === gen.current) {
        inflight.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    gen.current += 1;
    inflight.current = false;
    setItems([]);
    setCursor(null);
    setDone(false);
    setFailed(false);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, enabled]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loading && !failed && !done) void load(cursor);
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, failed, done, load, items.length]);

  const retry = useCallback(() => void load(cursor), [load, cursor]);
  return { items, setItems, loading, failed, done, retry, sentinel, hasMore: !!cursor };
}
