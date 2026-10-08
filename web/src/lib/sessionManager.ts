/**
 * Browser singleton around ./sessionCore. Single source of truth for the
 * current session; reads/writes the same localStorage key SessionContext used
 * ('streaming.session'). See sessionCore.ts for the refresh/lock semantics.
 */
import { requestRefresh } from './api';
import { rememberPostLoginPath } from './redirect';
import { createSessionManager, SESSION_STORAGE_KEY, type StorageLike } from './sessionCore';

export { SESSION_STORAGE_KEY };
export type { Session, SessionListener } from './sessionCore';

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function safeLocks() {
  try {
    const l = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: unknown }).locks : undefined;
    return l && typeof (l as { request?: unknown }).request === 'function' ? (l as never) : null;
  } catch {
    return null;
  }
}

export const sessionManager = createSessionManager({
  storage: safeStorage(),
  refresh: requestRefresh,
  locks: safeLocks(),
});

// Remember where the user was so login returns them there. Registered first,
// so it runs before any UI listener navigates away.
sessionManager.onSessionLost(() => {
  try {
    rememberPostLoginPath(window.location.pathname + window.location.search + window.location.hash);
  } catch {
    /* ignore */
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_STORAGE_KEY || e.key === null) sessionManager.handleStorageEvent();
  });
  const wake = () => sessionManager.wake();
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  // Arm the proactive refresh timer for a session restored from storage.
  try {
    sessionManager.wake();
  } catch {
    /* ignore */
  }
}

export const getAccessToken = () => sessionManager.getAccessToken();
export const refreshNow = (staleAccessToken?: string | null) => sessionManager.refreshNow({ staleAccessToken });
