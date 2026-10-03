import type { HubPost } from '../../lib/hub';
import { cx } from '../../lib/format';

export function formatPnl(v: number): string {
  const n = Number(v.toFixed(2));
  return `${n > 0 ? '+' : ''}${n}%`;
}

export default function PostBadges({ post }: { post: Pick<HubPost, 'symbol' | 'side' | 'pnlPercent'> }) {
  const { symbol, side, pnlPercent } = post;
  if (!symbol && !side && pnlPercent == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {symbol && (
        <span className="rounded-md border border-border bg-hover px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
          {symbol}
        </span>
      )}
      {side && (
        <span
          className={cx(
            'rounded-md px-2 py-0.5 text-xs font-semibold uppercase',
            side === 'long' && 'bg-success/15 text-success',
            side === 'short' && 'bg-danger/15 text-danger',
            side === 'spot' && 'bg-accent/15 text-accent'
          )}
        >
          {side}
        </span>
      )}
      {pnlPercent != null && (
        <span
          className={cx(
            'rounded-md px-2 py-0.5 text-xs font-bold',
            pnlPercent >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
          )}
        >
          {formatPnl(pnlPercent)}
        </span>
      )}
    </div>
  );
}
