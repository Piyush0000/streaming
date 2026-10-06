import { useEffect, useRef } from 'react';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { usePolled } from '../hooks/usePolled';
import { fetchRecentJoins, postJoined } from '../lib/activity';
import { joinSentFlag, markJoinSent, readStoredSource } from '../lib/joinSource';
import { planJoinToast } from '../lib/joinToasts';
import { playJoinSound } from '../lib/sounds';

const POLL_MS = 15_000;

function cursorKey(userId: string) {
  return `streaming.joinCursor.${userId}`;
}
function readCursor(userId: string): string | null {
  try {
    return localStorage.getItem(cursorKey(userId));
  } catch {
    return null;
  }
}
function writeCursor(userId: string, v: string) {
  try {
    localStorage.setItem(cursorKey(userId), v);
  } catch {
    /* ignore */
  }
}

/**
 * Renders nothing. (1) Once after login, reports this user's first-touch join
 * source. (2) Polls the join feed and toasts new joins once per browser.
 * Every failure is swallowed (logged) - this must never affect the app.
 */
export default function ActivityNotifier() {
  const { session } = useSession();
  const { showToast } = useToast();
  const token = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const cursorRef = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const loadedFor = useRef<string | null>(null);

  // Report join source once.
  useEffect(() => {
    if (!token || !userId) return;
    try {
      if (joinSentFlag()) return;
      const stored = readStoredSource();
      if (!stored) return;
      postJoined(token, stored.source)
        .then(() => markJoinSent())
        .catch((err) => console.warn('[activity] join report failed', err));
    } catch (err) {
      console.warn('[activity] join report error', err);
    }
  }, [token ? userId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data } = usePolled(
    async () => {
      const t = tokenRef.current;
      if (!t) return [];
      return fetchRecentJoins(t, cursorRef.current, 20);
    },
    POLL_MS,
    !!token
  );

  useEffect(() => {
    if (!data || !userId) return;
    try {
      if (loadedFor.current !== userId) {
        loadedFor.current = userId;
        cursorRef.current = readCursor(userId);
        seen.current = new Set();
      }
      const plan = planJoinToast(data, cursorRef.current, userId, seen.current);
      if (plan.cursor && plan.cursor !== cursorRef.current) {
        cursorRef.current = plan.cursor;
        writeCursor(userId, plan.cursor);
      }
      for (const e of plan.fresh) seen.current.add(e.id);
      if (plan.message) {
        showToast(plan.message, 'info', 6000);
        try {
          playJoinSound();
        } catch {
          /* audio is best-effort */
        }
      }
    } catch (err) {
      console.warn('[activity] toast failed', err);
    }
  }, [data, userId, showToast]);

  return null;
}
