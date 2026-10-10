import { useCallback, useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { paperApi, REASON_LABEL, type PaperTrade } from '../../lib/paper';
import { formatPnl, formatSignedPct } from '../../lib/paperMath';
import { baseSymbol, formatPrice } from '../../lib/marketMath';
import { relativeTime } from '../../lib/format';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import ErrorBanner from '../ErrorBanner';
import { pnlColor, SideBadge } from './PositionCard';

export interface ShareState {
  share: { symbol: string; side: 'long' | 'short'; pnlPercent: number };
}

export default function HistoryTab({ token, refreshKey }: { token: string; refreshKey: number }) {
  const navigate = useNavigate();
  const [trades, setTrades] = useState<PaperTrade[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const loadFirst = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await paperApi.history(token);
      if (mine !== seq.current) return;
      setTrades(r.trades);
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load history.');
      setTrades((t) => t ?? []);
    }
  }, [token]);

  useEffect(() => {
    void loadFirst();
    return () => {
      seq.current++;
    };
  }, [loadFirst, refreshKey]);

  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await paperApi.history(token, cursor);
      setTrades((t) => {
        const seen = new Set((t ?? []).map((x) => x.id));
        return [...(t ?? []), ...r.trades.filter((x) => !seen.has(x.id))];
      });
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  function share(t: PaperTrade) {
    const state: ShareState = {
      share: { symbol: t.symbol, side: t.side === 'LONG' ? 'long' : 'short', pnlPercent: Math.round(t.roePct * 100) / 100 },
    };
    navigate('/elonixhub', { state });
  }

  if (trades === null) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading history" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {trades.length === 0 && !error && (
        <EmptyState character="bear" title="No closed trades yet" body="Closed paper trades will show up here." size={96} />
      )}
      <ul className="flex flex-col gap-2">
        {trades.map((t) => (
          <li key={t.id} className="rounded-xl border border-border bg-panel p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{baseSymbol(t.symbol)}/USDT</span>
                <SideBadge side={t.side} />
                <span className="text-[11px] text-text-muted">{t.leverage}x</span>
                <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                  {t.exitReason ? REASON_LABEL[t.exitReason] : 'Closed'}
                </span>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold tabular-nums ${pnlColor(t.realizedPnl)}`}>{formatPnl(t.realizedPnl)}</div>
                <div className={`text-xs font-semibold tabular-nums ${pnlColor(t.roePct)}`}>{formatSignedPct(t.roePct)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
              <span className="tabular-nums">
                {formatPrice(t.entryPrice)} → {t.exitPrice !== null ? formatPrice(t.exitPrice) : '—'}
                {t.closedAt && <> · {relativeTime(t.closedAt)}</>}
              </span>
              <button
                type="button"
                onClick={() => share(t)}
                className="tap inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-accent hover:bg-accent-soft"
              >
                <Share2 size={12} /> Share to Elonix Hub
              </button>
            </div>
          </li>
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          onClick={() => void more()}
          disabled={loadingMore}
          className="tap self-center rounded-lg border border-border px-5 py-2 text-sm text-text-secondary hover:bg-hover disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
