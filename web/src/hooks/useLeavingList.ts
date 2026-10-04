import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface LeavingEntry<T> {
  item: T;
  leaving: boolean;
}

interface Ghost<T> {
  key: string;
  item: T;
  index: number;
}

/**
 * Keeps removed items rendered for `ms` (flagged `leaving`) so a list can play
 * an exit animation. Current items are returned immediately - additions are
 * never delayed. Removed items are re-inserted at their previous index.
 */
export function useLeavingList<T>(items: T[], getKey: (item: T) => string, ms = 200): LeavingEntry<T>[] {
  const prevRef = useRef<T[]>(items);
  const [ghosts, setGhosts] = useState<Ghost<T>[]>([]);
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const timers = useRef<number[]>([]);

  useLayoutEffect(() => {
    const keyOf = getKeyRef.current;
    const currentKeys = new Set(items.map(keyOf));
    const removed: Ghost<T>[] = [];
    prevRef.current.forEach((item, index) => {
      const key = keyOf(item);
      if (!currentKeys.has(key)) removed.push({ key, item, index });
    });
    prevRef.current = items;
    if (removed.length === 0 && ghosts.every((g) => !currentKeys.has(g.key))) return;

    setGhosts((g) => {
      const kept = g.filter((x) => !currentKeys.has(x.key));
      const known = new Set(kept.map((x) => x.key));
      return [...kept, ...removed.filter((x) => !known.has(x.key))];
    });

    if (removed.length > 0) {
      const keys = removed.map((r) => r.key);
      const timer = window.setTimeout(() => {
        setGhosts((g) => g.filter((x) => !keys.includes(x.key)));
      }, ms);
      timers.current.push(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ms]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    []
  );

  const out: LeavingEntry<T>[] = items.map((item) => ({ item, leaving: false }));
  const live = new Set(items.map(getKey));
  const sorted = ghosts.filter((g) => !live.has(g.key)).sort((a, b) => a.index - b.index);
  for (const ghost of sorted) {
    out.splice(Math.min(ghost.index, out.length), 0, { item: ghost.item, leaving: true });
  }
  return out;
}
