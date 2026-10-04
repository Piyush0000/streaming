/** Pure layout helpers for the participant grid (kept free of React so they can be unit-tested). */

/**
 * Columns for `count` equal 16:9 tiles: 1 -> 1, 2-4 -> 2, 5-9 -> 3, 10+ -> 4,
 * capped by the container width so tiles stay readable on phones
 * (< 480px: at most 2 columns, and a single column for 1-2 tiles).
 * `width` is the container width in px; omit for "unconstrained".
 */
export function gridColumns(count: number, width: number = Number.POSITIVE_INFINITY): number {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return 1;
  const byCount = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const byWidth = width < 480 ? 2 : width < 768 ? 3 : 4;
  let cols = Math.min(byCount, byWidth);
  if (width < 480 && n <= 2) cols = 1;
  return Math.max(1, Math.min(cols, n));
}

/**
 * Which tile (if any) is promoted to the large spotlight: the pinned tile if it
 * still exists, otherwise the first screen share, otherwise none (plain grid).
 */
export function resolveSpotlight(
  pinnedId: string | null,
  screenIds: readonly string[],
  tileIds: readonly string[]
): string | null {
  if (pinnedId && (screenIds.includes(pinnedId) || tileIds.includes(pinnedId))) return pinnedId;
  return screenIds[0] ?? null;
}
