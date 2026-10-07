/** Pure price/number formatting for the market views (no DOM access; unit-tested). */

const DASH = '—';

/** Price with adaptive precision: tiny prices keep 4 significant digits (0.00001234), big ones use 2dp. */
export function formatPriceSmart(p: number | null | undefined): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return DASH;
  if (p === 0) return '0.00';
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (abs >= 0.01) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // Sub-cent: show 4 significant digits after the leading zeros.
  const leadingZeros = Math.max(0, Math.floor(-Math.log10(abs)));
  const dp = Math.min(12, leadingZeros + 4);
  return p.toFixed(dp);
}

/** Compact K/M/B/T notation: 1_234_567 -> "1.23M". */
export function formatCompactNumber(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

/** "+1.23%" / "-0.40%"; em dash when missing. */
export function formatPct(c: number | null | undefined): string {
  if (typeof c !== 'number' || !Number.isFinite(c)) return DASH;
  return `${c > 0 ? '+' : ''}${c.toFixed(2)}%`;
}

/** Where price sits between low and high, clamped to 0..1; 0.5 when the range is degenerate. */
export function rangePosition(price: number, low: number, high: number): number {
  if (![price, low, high].every(Number.isFinite) || high <= low) return 0.5;
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}
