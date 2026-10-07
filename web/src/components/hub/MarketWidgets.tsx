import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Globe2, TrendingDown, TrendingUp } from 'lucide-react';
import { usePolled } from '../../hooks/usePolled';
import {
  fetchMovers,
  fetchOverview,
  hubMarketPath,
  type MarketOverview,
  type MarketSymbol,
} from '../../lib/hubMarket';
import { formatCompactNumber, formatPct, formatPriceSmart } from '../../lib/priceFormat';
import { cx } from '../../lib/format';
import Skeleton from '../Skeleton';

/** Colour for a 0..100 fear & greed value. */
export function fearGreedColor(v: number): string {
  if (v < 25) return '#ef4444';
  if (v < 45) return '#f97316';
  if (v < 55) return '#eab308';
  if (v < 75) return '#84cc16';
  return '#22c55e';
}

/** Animated SVG semicircle gauge. Arc length is driven by stroke-dashoffset (CSS transition). */
export function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const v = Math.min(100, Math.max(0, value));
  const r = 80;
  const len = Math.PI * r;
  const color = fearGreedColor(v);
  const angle = -90 + (v / 100) * 180;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" role="img" aria-label={`Fear and Greed index ${Math.round(v)} out of 100, ${label}`} className="w-full max-w-[220px]">
        <path d={`M 20 100 A ${r} ${r} 0 0 1 180 100`} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="14" strokeLinecap="round" />
        <path
          className="gauge-arc"
          d={`M 20 100 A ${r} ${r} 0 0 1 180 100`}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - v / 100)}
        />
        <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
        </g>
        <circle cx="100" cy="100" r="5" fill="currentColor" opacity="0.9" />
        <text x="100" y="86" textAnchor="middle" fontSize="26" fontWeight="800" fill={color} className="tabular-nums">
          {Math.round(v)}
        </text>
      </svg>
      {label && <p className="-mt-1 text-sm font-bold" style={{ color }}>{label}</p>}
    </div>
  );
}

function Stat({ icon, label, value, sub, subTone }: { icon: ReactNode; label: string; value: string; sub?: string; subTone?: 'up' | 'down' }) {
  return (
    <div className="rounded-xl border border-border bg-panel/50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {icon} {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className={cx('text-[11px] tabular-nums', subTone === 'up' ? 'text-success' : subTone === 'down' ? 'text-danger' : 'text-text-muted')}>{sub}</p>}
    </div>
  );
}

/** Fear & Greed + global stats. Any piece that the API reports as null is simply not rendered. */
export function OverviewPanel({ overview, loading }: { overview: MarketOverview | null; loading: boolean }) {
  if (!overview) {
    return loading ? (
      <div role="status" aria-busy="true" aria-label="Loading market overview" className="space-y-3">
        <Skeleton className="mx-auto h-24 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    ) : null;
  }
  const g = overview.global;
  const cards: ReactNode[] = [];
  if (g && g.totalMarketCapUsd !== null)
    cards.push(
      <Stat
        key="cap"
        icon={<Globe2 size={12} aria-hidden />}
        label="Market cap"
        value={`$${formatCompactNumber(g.totalMarketCapUsd)}`}
        sub={g.marketCapChangePct24h !== null ? `${formatPct(g.marketCapChangePct24h)} 24h` : undefined}
        subTone={g.marketCapChangePct24h !== null ? (g.marketCapChangePct24h >= 0 ? 'up' : 'down') : undefined}
      />
    );
  if (g && g.btcDominancePct !== null)
    cards.push(<Stat key="dom" icon={<Activity size={12} aria-hidden />} label="BTC dominance" value={`${g.btcDominancePct.toFixed(1)}%`} />);
  if (g && g.activeCryptos !== null)
    cards.push(<Stat key="act" icon={<Activity size={12} aria-hidden />} label="Active cryptos" value={Math.round(g.activeCryptos).toLocaleString('en-US')} />);
  if (!overview.fearGreed && cards.length === 0) return null;
  return (
    <div className="space-y-3">
      {overview.fearGreed && (
        <section className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-sm font-bold">Fear &amp; Greed</h2>
          <FearGreedGauge value={overview.fearGreed.value} label={overview.fearGreed.label} />
        </section>
      )}
      {cards.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">{cards}</div>}
    </div>
  );
}

function MoverRow({ s }: { s: MarketSymbol }) {
  const up = s.changePct >= 0;
  return (
    <li>
      <Link to={hubMarketPath.marketsFor(s.symbol)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs hover:bg-hover/60">
        <span className="w-14 shrink-0 truncate font-bold">{s.base}</span>
        <span className="min-w-0 flex-1 truncate text-right tabular-nums text-text-secondary">{formatPriceSmart(s.price)}</span>
        <span className={cx('w-16 shrink-0 text-right font-semibold tabular-nums', up ? 'text-success' : 'text-danger')}>{formatPct(s.changePct)}</span>
      </Link>
    </li>
  );
}

/** Top gainers / losers mini-lists (polled). */
export function MoversMini({ pollMs = 15_000 }: { pollMs?: number }) {
  const { data, loading } = usePolled((signal) => fetchMovers(signal), pollMs);
  const lists = [
    { title: 'Top gainers', icon: <TrendingUp size={14} className="text-success" aria-hidden />, rows: data?.gainers.slice(0, 5) ?? [] },
    { title: 'Top losers', icon: <TrendingDown size={14} className="text-danger" aria-hidden />, rows: data?.losers.slice(0, 5) ?? [] },
  ];
  if (!data && !loading) return null;
  return (
    <section className="glass rounded-2xl p-4">
      <h2 className="mb-2 text-sm font-bold">Top movers</h2>
      {!data ? (
        <div role="status" aria-busy="true" aria-label="Loading movers" className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        lists
          .filter((l) => l.rows.length > 0)
          .map((l) => (
            <div key={l.title} className="mb-2 last:mb-0">
              <p className="flex items-center gap-1.5 px-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {l.icon} {l.title}
              </p>
              <ul>{l.rows.map((s) => <MoverRow key={s.symbol} s={s} />)}</ul>
            </div>
          ))
      )}
    </section>
  );
}

export function useOverview(pollMs = 30_000) {
  return usePolled((signal) => fetchOverview(signal), pollMs);
}
