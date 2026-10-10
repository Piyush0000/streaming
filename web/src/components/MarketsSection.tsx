import { useEffect, useRef, useState } from 'react';
import { Calculator, ChevronDown, ChevronRight, Compass, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchSignals, fetchTickers, type MarketSignal, type MarketTicker } from '../lib/market';
import {
  baseSymbol,
  formatAge,
  formatChangePct,
  formatCompact,
  formatPrice,
} from '../lib/marketMath';
import { prefersReducedMotion, safeGet, safeSet } from '../lib/motion';
import { usePolled } from '../hooks/usePolled';
import { cx } from '../lib/format';
import Skeleton from './Skeleton';

const OPEN_KEY = 'elonix:sidebar:markets-open';
const BOT_URL = 'https://lr21.org';

export default function MarketsSection({
  onNavigateHub,
  onOpenCalculator,
}: {
  onNavigateHub: () => void;
  onOpenCalculator: () => void;
}) {
  const [open, setOpen] = useState<boolean>(() => safeGet(OPEN_KEY) !== '0');

  function toggle() {
    setOpen((o) => {
      safeSet(OPEN_KEY, o ? '0' : '1');
      return !o;
    });
  }

  return (
    <div className="mb-3" data-tour="markets">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted max-md:min-h-[44px] hover:text-text-primary"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Markets
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <Tickers />
          <Signals />
          <div className="flex flex-col gap-0.5">
            <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Tools</p>
            <button
              onClick={onOpenCalculator}
              className="nav-item flex w-full items-center gap-2 max-md:min-h-[44px] rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              <Calculator size={14} className="shrink-0 text-text-muted" />
              Position size calculator
            </button>
            <button
              onClick={onNavigateHub}
              className="nav-item flex w-full items-center gap-2 max-md:min-h-[44px] rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              <Compass size={14} className="shrink-0 text-text-muted" />
              Hub: trade feed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tickers() {
  const { data, error, loading, reload } = usePolled((s) => fetchTickers(s), 10_000);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading prices" className="flex flex-col gap-1.5 px-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-2 text-xs text-text-muted">
        <p className="text-danger">{error ?? 'Prices unavailable.'}</p>
        <button onClick={reload} className="mt-1 flex min-h-[44px] items-center gap-1 font-medium text-accent hover:underline md:min-h-0">
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }
  if (data.tickers.length === 0) return <p className="px-2 text-xs text-text-muted">No prices available.</p>;

  return (
    <div>
      <ul className="flex flex-col gap-0.5">
        {data.tickers.map((t) => (
          <TickerRow
            key={t.symbol}
            t={t}
            expanded={expanded === t.symbol}
            onToggle={() => setExpanded((cur) => (cur === t.symbol ? null : t.symbol))}
          />
        ))}
      </ul>
      {(error || data.stale) && (
        <p className="px-2 pt-1 text-[11px] text-warning" role="status">
          {data.stale
            ? `Delayed: showing prices from ${formatAge(Math.round((Date.now() - Date.parse(data.updatedAt)) / 1000))}.`
            : `Update failed, showing last prices. ${error}`}
        </p>
      )}
    </div>
  );
}

function TickerRow({ t, expanded, onToggle }: { t: MarketTicker; expanded: boolean; onToggle: () => void }) {
  const prev = useRef<number | null>(null);
  const priceRef = useRef<HTMLSpanElement>(null);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = t.price;
    if (before === null || before === t.price) return;
    setDir(t.price > before ? 'up' : 'down');
    const el = priceRef.current;
    if (el && !prefersReducedMotion() && typeof el.animate === 'function') {
      const y = t.price > before ? 4 : -4;
      el.animate(
        [
          { opacity: 0.35, transform: `translateY(${y}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 400, easing: 'cubic-bezier(0.22,1,0.36,1)' }
      );
    }
  }, [t.price]);

  const up = t.changePct >= 0;
  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="nav-item flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors max-md:min-h-[44px] hover:bg-hover"
      >
        <span className="w-11 shrink-0 font-medium text-text-primary">{baseSymbol(t.symbol)}</span>
        <span
          ref={priceRef}
          className={cx(
            'min-w-0 flex-1 truncate text-right tabular-nums',
            dir === 'up' ? 'text-success' : dir === 'down' ? 'text-danger' : 'text-text-secondary'
          )}
        >
          {formatPrice(t.price)}
        </span>
        <span
          className={cx('w-[58px] shrink-0 text-right text-xs tabular-nums', up ? 'text-success' : 'text-danger')}
          aria-label={`24 hour change ${formatChangePct(t.changePct)}`}
        >
          {formatChangePct(t.changePct)}
        </span>
      </button>
      {expanded && (
        <dl className="mx-2 mb-1 grid animate-slide-down grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-hover/60 px-2 py-1.5 text-[11px]">
          <dt className="text-text-muted">24h high</dt>
          <dd className="text-right tabular-nums text-text-secondary">{formatPrice(t.high)}</dd>
          <dt className="text-text-muted">24h low</dt>
          <dd className="text-right tabular-nums text-text-secondary">{formatPrice(t.low)}</dd>
          <dt className="text-text-muted">24h volume</dt>
          <dd className="text-right tabular-nums text-text-secondary">
            {formatCompact(t.volume)} {baseSymbol(t.symbol)}
          </dd>
        </dl>
      )}
    </li>
  );
}

const ACTION_STYLE: Record<MarketSignal['action'], string> = {
  BUY: 'bg-success/15 text-success',
  SELL: 'bg-danger/15 text-danger',
  NEUTRAL: 'bg-hover text-text-secondary',
};

function Signals() {
  const { data, error, loading, reload } = usePolled((s) => fetchSignals(s), 60_000);
  const latest = data?.signals.slice(0, 5) ?? [];
  const newestAge = latest.length > 0 ? Math.min(...latest.map((s) => s.ageSeconds)) : null;
  const allStale = latest.length > 0 && latest.every((s) => s.stale);

  return (
    <div>
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Signals</p>
      {loading && !data ? (
        <div role="status" aria-busy="true" aria-label="Loading signals" className="flex flex-col gap-1.5 px-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !data ? (
        <div className="px-2 text-xs text-text-muted">
          <p className="text-danger">{error ?? 'Signals unavailable.'}</p>
          <button onClick={reload} className="mt-1 flex min-h-[44px] items-center gap-1 font-medium text-accent hover:underline md:min-h-0">
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      ) : latest.length === 0 ? (
        <p className="px-2 text-xs text-text-muted">No signals published yet.</p>
      ) : (
        <>
          {allStale && newestAge !== null && (
            <p
              role="status"
              className="mx-2 mb-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning"
            >
              Stale — last update {formatStaleAge(newestAge)}. These are not live signals.
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {latest.map((s) => (
              <li
                key={s.id}
                className={cx('flex items-center gap-2 rounded-md px-2 py-1 text-sm', s.stale && 'italic')}
                title={s.strategy ? `${s.strategy}${s.source ? ` (${s.source})` : ''}` : undefined}
              >
                <span className={cx('w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold', ACTION_STYLE[s.action])}>
                  {s.action}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-text-primary">
                    {s.symbol}
                    {s.price !== null && <span className="text-text-secondary"> @ {formatPrice(s.price)}</span>}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {s.confidence !== null ? `${Math.round(s.confidence)}% conf · ` : ''}
                    {formatAge(s.ageSeconds)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="px-2 pt-1 text-[11px] text-warning">Update failed, showing last signals.</p>}
        </>
      )}
      <a
        href={BOT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-2 mt-1 inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-accent hover:underline md:min-h-0"
      >
        Open Elonix trading bot <ExternalLink size={11} />
      </a>
    </div>
  );
}

function formatStaleAge(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatAge(seconds);
}
