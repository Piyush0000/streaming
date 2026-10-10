/**
 * True when there is an in-app page to go back to. react-router stores its position in
 * history.state.idx (0 = first entry of this tab), so a post opened from a shared link
 * (idx 0) falls back to the hub home instead of bouncing the user out of the site.
 */
export function canGoBackInApp(state: unknown = typeof window !== 'undefined' ? window.history.state : null): boolean {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}
