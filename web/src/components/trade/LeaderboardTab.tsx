import { Trophy } from 'lucide-react';
import { paperApi } from '../../lib/paper';
import { formatPnl, formatSignedPct } from '../../lib/paperMath';
import { usePolled } from '../../hooks/usePolled';
import { cx } from '../../lib/format';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import ErrorBanner from '../ErrorBanner';
import { pnlColor } from './PositionCard';

export default function LeaderboardTab({ token }: { token: string }) {
  const { data, error, loading } = usePolled((s) => paperApi.leaderboard(token, s), 20_000);

  if (loading && !data) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading leaderboard" className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (!data) return <ErrorBanner message={error ?? 'Could not load the leaderboard.'} />;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">
        Top paper traders, last {data.windowDays} days. {data.basis}. Virtual funds only.
      </p>
      {data.entries.length === 0 ? (
        <EmptyState character="rocket" title="Nobody on the board yet" body="Close a paper trade to claim the first spot." size={96} />
      ) : (
        <ol className="flex flex-col gap-1.5">
          {data.entries.map((e) => (
            <li
              key={e.rank}
              className={cx('flex items-center gap-3 rounded-xl border px-3 py-2.5', e.me ? 'border-accent bg-accent-soft' : 'border-border bg-panel')}
            >
              <span className="flex w-6 shrink-0 justify-center text-sm font-bold tabular-nums text-text-secondary">
                {e.rank <= 3 ? <Trophy size={16} className={e.rank === 1 ? 'text-warning' : 'text-text-muted'} aria-label={`Rank ${e.rank}`} /> : e.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {e.name}
                {e.me && <span className="ml-1.5 text-[11px] text-accent">(you)</span>}
              </span>
              <span className="shrink-0 text-right">
                <span className={cx('block text-sm font-bold tabular-nums', pnlColor(e.pnlPct))}>{formatSignedPct(e.pnlPct)}</span>
                <span className="block text-[11px] tabular-nums text-text-muted">
                  {formatPnl(e.pnl)} · {e.trades} trade{e.trades === 1 ? '' : 's'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
