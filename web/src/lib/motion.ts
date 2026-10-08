/** Small, crash-proof helpers shared by the animation layer. */

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked / full: nothing to do */
  }
}

/** Sets html[data-tab-hidden] so CSS can pause infinite animations while the tab is in the background. */
export function installVisibilityPause(): void {
  try {
    if (typeof document === 'undefined') return;
    const apply = () => document.documentElement.setAttribute('data-tab-hidden', document.hidden ? 'true' : 'false');
    apply();
    document.addEventListener('visibilitychange', apply);
    // Safety: a missed visibilitychange (bfcache restore, popup/redirect sign-in flows) must never leave
    // the flag stuck on, because paused entrance animations keep whole pages at opacity 0 (blank screen).
    window.addEventListener('focus', apply);
    window.addEventListener('pageshow', apply);
  } catch {
    /* non-critical */
  }
}
