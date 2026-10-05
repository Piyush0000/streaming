import { useCallback, useEffect, useRef } from 'react';

type Notify = (message: string, kind?: 'info' | 'success' | 'error' | 'warning') => void;

const BATCH_MS = 1500;
const MAX_NAMES = 3;

/**
 * Turns peer join/leave events into toasts. Events arriving close together are
 * batched ("A, B and 4 others joined") so a busy room never floods the screen.
 */
export function useJoinToasts(notify: Notify, where: string) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const whereRef = useRef(where);
  whereRef.current = where;
  const joined = useRef<string[]>([]);
  const left = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const emit = (names: string[], verb: string) => {
      if (names.length === 0) return;
      const shown = names.slice(0, MAX_NAMES).join(', ');
      const extra = names.length - MAX_NAMES;
      const who = extra > 0 ? `${shown} and ${extra} other${extra > 1 ? 's' : ''}` : shown;
      try {
        notifyRef.current(`${who} ${verb} ${whereRef.current}`, 'info');
      } catch {
        /* a failed toast must never break the call */
      }
    };
    const j = joined.current;
    const l = left.current;
    joined.current = [];
    left.current = [];
    emit(j, 'joined');
    emit(l, 'left');
  }, []);

  const schedule = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(flush, BATCH_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const peerJoined = useCallback(
    (name: string) => {
      if (!name) return;
      joined.current.push(name);
      schedule();
    },
    [schedule]
  );
  const peerLeft = useCallback(
    (name: string) => {
      if (!name) return;
      left.current.push(name);
      schedule();
    },
    [schedule]
  );
  return { peerJoined, peerLeft };
}
