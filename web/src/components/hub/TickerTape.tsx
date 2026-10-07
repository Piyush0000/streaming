import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Newspaper } from 'lucide-react';
import { usePolled } from '../../hooks/usePolled';
import { fetchHeadlines, fetchSymbols, hubMarketPath, type MarketSymbol, type NewsItem } from '../../lib/hubMarket';
import { formatPct, formatPriceSmart } from '../../lib/priceFormat';
import { cx, relativeTime } from '../../lib/format';
import Skeleton from '../Skeleton';

const TAPE_COUNT = 20;

const TapeItem = memo(function TapeItem({ s, dup }: { s: MarketSymbol; dup?: boolean }) {
  const up = s.changePct >= 0;
  return (
    <Link
      to={hubMarketPath.marketsFor(s.symbol)}
      tabIndex={dup ? -1 : undefined}
      className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="font-bold text-text-primary">{s.base}</span>
      <span className="tabular-nums text-text-secondary">{formatPriceSmart(s.price)}</span>
      <span className={cx('tabular-nums font-semibold', up ? 'text-success' : 'text-danger')}>
        <span aria-hidden>{up ? '▲' : '▼'}</span> {formatPct(s.changePct)}
      </span>
    </Link>
  );
});

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => (typeof document === 'undefined' ? false : document.hidden));
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/** Live marquee of the top symbols by volume; clicking one opens the markets page filtered to it. */
function Tape() {
  const hidden = useDocumentHidden();
  const { data, loading, error } = usePolled((signal) => fetchSymbols({ limit: TAPE_COUNT, sort: 'volume' }, signal), 5000);
  const symbols = data?.symbols.slice(0, TAPE_COUNT) ?? [];

  if (symbols.length === 0) {
    if (loading)
      return (
        <div role="status" aria-busy="true" aria-label="Loading prices" className="flex gap-4 overflow-hidden px-3 py-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-28 shrink-0" />
          ))}
        </div>
      );
    return (
      <p className="px-3 py-2 text-xs text-text-muted">{error ? 'Live prices are unavailable right now.' : 'No prices to show yet.'}</p>
    );
  }

  // Roughly constant px/sec regardless of how many symbols there are.
  const dur = Math.max(30, symbols.length * 4);
  return (
    <div
      className="tape-wrap tape-fade"
      data-paused={hidden}
      role="region"
      aria-label="Live market prices"
    >
      <div className="tape-track" style={{ ['--tape-dur' as string]: `${dur}s` }}>
        <div className="flex">
          {symbols.map((s) => (
            <TapeItem key={s.symbol} s={s} />
          ))}
        </div>
        <div className="tape-dup flex" aria-hidden="true">
          {symbols.map((s) => (
            <TapeItem key={s.symbol} s={s} dup />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Cycles the top headlines every 6s with a fade. Pauses on hover/focus and while the tab is hidden. */
function HeadlineRotator() {
  const hidden = useDocumentHidden();
  const { data } = usePolled((signal) => fetchHeadlines(signal), 60_000);
  const items: NewsItem[] = data ?? [];
  const [idx, setIdx] = useState(0);
  const [hold, setHold] = useState(false);

  useEffect(() => {
    if (items.length < 2 || hold || hidden) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => window.clearInterval(t);
  }, [items.length, hold, hidden]);

  if (items.length === 0) return null;
  const item = items[idx % items.length]!;
  return (
    <div
      className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5 text-xs"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <span className="inline-flex shrink-0 items-center gap-1 font-semibold uppercase tracking-wide text-accent">
        <Newspaper size={12} aria-hidden /> Headlines
      </span>
      <div className="min-w-0 flex-1" aria-live="off">
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="headline-fade flex min-w-0 items-center gap-2 text-text-secondary hover:text-text-primary"
        >
          <span className="truncate">{item.title}</span>
          <span className="hidden shrink-0 text-text-muted sm:inline">
            {item.source}
            {item.publishedAt ? ` · ${relativeTime(item.publishedAt)}` : ''}
          </span>
          <ExternalLink size={11} aria-hidden className="shrink-0 text-text-muted" />
        </a>
      </div>
      <Link to={hubMarketPath.news} className="shrink-0 font-semibold text-text-muted hover:text-text-primary">
        All news
      </Link>
    </div>
  );
}

export default function TickerTape() {
  return (
    <div className="border-b border-border bg-base/70 backdrop-blur" aria-label="Market ticker">
      <div className="mx-auto max-w-5xl">
        <Tape />
        <HeadlineRotator />
      </div>
    </div>
  );
}
