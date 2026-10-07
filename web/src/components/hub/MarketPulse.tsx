import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { usePolled } from '../../hooks/usePolled';
import { fetchHeadlines, fetchSymbols, hubMarketPath } from '../../lib/hubMarket';
import { formatPct, formatPriceSmart } from '../../lib/priceFormat';
import { cx } from '../../lib/format';
import Skeleton from '../Skeleton';
import { fearGreedColor, useOverview } from './MarketWidgets';

const WATCH = ['BTC', 'ETH', 'SOL'];

/** Compact market snapshot for the hub home sidebar. Every block hides itself if its data is missing. */
export default function MarketPulse() {
  const syms = usePolled((signal) => fetchSymbols({ limit: 200, sort: 'volume' }, signal), 10_000);
  const heads = usePolled((signal) => fetchHeadlines(signal), 60_000);
  const overview = useOverview();

  const rows = WATCH.map((b) => syms.data?.symbols.find((s) => s.base === b && s.quote === 'USDT') ?? syms.data?.symbols.find((s) => s.base === b)).filter(
    (s): s is NonNullable<typeof s> => !!s
  );
  const latest = (heads.data ?? []).slice(0, 3);
  const fg = overview.data?.fearGreed ?? null;
  const loading = syms.loading && !syms.data;

  return (
    <section className="glass rounded-2xl p-4" aria-label="Market pulse">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Activity size={15} className="text-accent" aria-hidden /> Market pulse
        {syms.data?.stale && <span className="ml-auto rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">cached</span>}
      </h2>
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading market pulse" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((s) => (
            <li key={s.symbol}>
              <Link to={hubMarketPath.marketsFor(s.symbol)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs hover:bg-hover/60">
                <span className="w-10 font-bold">{s.base}</span>
                <span className="flex-1 text-right tabular-nums text-text-secondary">{formatPriceSmart(s.price)}</span>
                <span className={cx('w-16 text-right font-semibold tabular-nums', s.changePct >= 0 ? 'text-success' : 'text-danger')}>{formatPct(s.changePct)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">Prices are unavailable right now.</p>
      )}
      {fg && (
        <p className="mt-2 flex items-center justify-between rounded-lg bg-panel/60 px-2 py-1.5 text-xs">
          <span className="text-text-muted">Fear &amp; Greed</span>
          <span className="font-bold tabular-nums" style={{ color: fearGreedColor(fg.value) }}>
            {Math.round(fg.value)} {fg.label}
          </span>
        </p>
      )}
      {latest.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
          {latest.map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-2 text-xs leading-snug text-text-secondary hover:text-text-primary">
                {n.title}
              </a>
              <span className="text-[10px] text-text-muted">{n.source}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex justify-between text-xs font-semibold">
        <Link to={hubMarketPath.news} className="text-accent hover:underline">
          More news
        </Link>
        <Link to={hubMarketPath.markets} className="text-accent hover:underline">
          All markets
        </Link>
      </div>
    </section>
  );
}
