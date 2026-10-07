import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, RefreshCw, Search, WifiOff, X } from 'lucide-react';
import HubShell from '../components/hub/HubShell';
import Skeleton from '../components/Skeleton';
import { usePolled } from '../hooks/usePolled';
import { fetchMovers, fetchSymbols, type MarketSymbol } from '../lib/hubMarket';
import { formatCompactNumber, formatPct, formatPriceSmart, rangePosition } from '../lib/priceFormat';
import { cx, relativeTime } from '../lib/format';

type SortKey = 'symbol' | 'price' | 'changePct' | 'high' | 'low' | 'quoteVolume';
type Tab = 'all' | 'gainers' | 'losers' | 'volume';

const CHUNK = 50;
const COLS = 'grid-cols-[minmax(6rem,1.3fr)_1fr_0.8fr_1fr_1fr_1.1fr_6rem]';
const HEADERS: Array<{ key: SortKey | null; label: string; align: string }> = [
  { key: 'symbol', label: 'Symbol', align: 'text-left' },
  { key: 'price', label: 'Price', align: 'text-right' },
  { key: 'changePct', label: '24h %', align: 'text-right' },
  { key: 'high', label: 'High', align: 'text-right' },
  { key: 'low', label: 'Low', align: 'text-right' },
  { key: 'quoteVolume', label: 'Volume', align: 'text-right' },
  { key: null, label: '24h range', align: 'text-right' },
];
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'volume', label: 'Volume' },
];

function RangeBar({ s }: { s: MarketSymbol }) {
  const pos = rangePosition(s.price, s.low, s.high);
  return (
    <div className="relative h-1.5 w-full rounded-full bg-hover" role="img" aria-label={`Price at ${Math.round(pos * 100)}% of the 24 hour range`}>
      <span
        className={cx('absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full', s.changePct >= 0 ? 'bg-success' : 'bg-danger')}
        style={{ left: `calc(${(pos * 100).toFixed(1)}% - 2px)` }}
      />
    </div>
  );
}

const Row = memo(function Row({ s }: { s: MarketSymbol }) {
  const prev = useRef(s.price);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);
  useEffect(() => {
    // Only react to changes after mount, so the first load never flashes.
    if (s.price === prev.current) return;
    const dir = s.price > prev.current ? 'up' : 'down';
    prev.current = s.price;
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
  }, [s.price]);

  const up = s.changePct >= 0;
  const pct = <span className={cx('font-semibold tabular-nums', up ? 'text-success' : 'text-danger')}>{formatPct(s.changePct)}</span>;
  return (
    <div role="row" className="relative overflow-hidden border-b border-border/60 px-3 py-2.5 text-sm hover:bg-hover/40">
      {flash && <span key={flash.n} aria-hidden className="flash-ov" data-dir={flash.dir} />}
      {/* mobile card */}
      <div className="md:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">
            {s.base}
            <span className="ml-1 text-[11px] font-normal text-text-muted">/{s.quote}</span>
          </span>
          <span className="tabular-nums font-semibold">{formatPriceSmart(s.price)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="tabular-nums text-text-muted">Vol {formatCompactNumber(s.quoteVolume)}</span>
          {pct}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] tabular-nums text-text-muted">
          <span>{formatPriceSmart(s.low)}</span>
          <RangeBar s={s} />
          <span>{formatPriceSmart(s.high)}</span>
        </div>
      </div>
      {/* desktop row */}
      <div className={cx('hidden items-center gap-3 md:grid', COLS)}>
        <span className="truncate font-bold">
          {s.base}
          <span className="ml-1 text-[11px] font-normal text-text-muted">/{s.quote}</span>
        </span>
        <span className="text-right tabular-nums">{formatPriceSmart(s.price)}</span>
        <span className="text-right">{pct}</span>
        <span className="text-right tabular-nums text-text-secondary">{formatPriceSmart(s.high)}</span>
        <span className="text-right tabular-nums text-text-secondary">{formatPriceSmart(s.low)}</span>
        <span className="text-right tabular-nums text-text-secondary">{formatCompactNumber(s.quoteVolume)}</span>
        <RangeBar s={s} />
      </div>
    </div>
  );
});

function compare(a: MarketSymbol, b: MarketSymbol, key: SortKey): number {
  return key === 'symbol' ? a.base.localeCompare(b.base) : a[key] - b[key];
}

export default function HubMarketsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(() => (params.get('q') ?? '').slice(0, 40));
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'quoteVolume', dir: 'desc' });
  const [tab, setTab] = useState<Tab>('all');
  const [shown, setShown] = useState(CHUNK);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  const symbolsPoll = usePolled((signal) => fetchSymbols({ limit: 200, sort: 'volume' }, signal), 5000);
  const moversPoll = usePolled((signal) => fetchMovers(signal), 15_000, tab !== 'all');
  const { data, error, loading, reload } = symbolsPoll;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Keep the URL's ?q= in sync (replace, so Back isn't flooded) and honour in-app links to a symbol.
  const urlQ = params.get('q') ?? '';
  useEffect(() => setQ(urlQ.slice(0, 40)), [urlQ]);
  const onSearch = (v: string) => {
    setQ(v.slice(0, 40));
    setShown(CHUNK);
    const next = new URLSearchParams(params);
    if (v.trim()) next.set('q', v.trim());
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const bySymbol = useMemo(() => new Map((data?.symbols ?? []).map((s) => [s.symbol, s])), [data]);

  const rows = useMemo(() => {
    let list: MarketSymbol[] = data?.symbols ?? [];
    if (tab !== 'all') {
      const m = moversPoll.data?.[tab];
      // Use live prices from the main poll when available.
      list = m ? m.map((x) => bySymbol.get(x.symbol) ?? x) : [];
    }
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((s) => s.symbol.toLowerCase().includes(needle) || s.base.toLowerCase().includes(needle));
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => sign * compare(a, b, sort.key) || a.symbol.localeCompare(b.symbol));
  }, [data, tab, moversPoll.data, bySymbol, q, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'symbol' ? 'asc' : 'desc' }));

  const hasData = !!data && data.symbols.length > 0;
  const moversLoading = tab !== 'all' && !moversPoll.data && moversPoll.loading;

  return (
    <HubShell sidebar={false} wide>
      <section aria-label="Markets" className="space-y-3">
        <div className="glass space-y-3 rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Market view" className="flex flex-1 gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setShown(CHUNK);
                  }}
                  className={cx(
                    'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    tab === t.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {data?.updatedAt && Number.isFinite(Date.parse(data.updatedAt)) && (
              <span className="text-[11px] text-text-muted">Updated {relativeTime(data.updatedAt)}</span>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={q}
                onChange={(e) => onSearch(e.target.value)}
                type="search"
                aria-label="Search symbols"
                placeholder="Search symbols (BTC, ETH…)"
                className="w-full rounded-full border border-border bg-base/60 py-2 pl-9 pr-9 text-sm outline-none transition-colors focus:border-accent"
              />
              {q && (
                <button type="button" onClick={() => onSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted hover:text-text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
            <label className="md:hidden">
              <span className="sr-only">Sort by</span>
              <select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                  setSort({ key, dir });
                }}
                className="rounded-full border border-border bg-base/60 px-3 py-2 text-xs outline-none focus:border-accent"
              >
                <option value="quoteVolume:desc">Volume</option>
                <option value="changePct:desc">Top gainers</option>
                <option value="changePct:asc">Top losers</option>
                <option value="price:desc">Price</option>
                <option value="symbol:asc">Name</option>
              </select>
            </label>
          </div>
        </div>

        {!online && (
          <p role="status" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
            <WifiOff size={13} aria-hidden /> You're offline. Showing the last prices received.
          </p>
        )}
        {online && hasData && data?.stale && (
          <p role="status" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
            <AlertTriangle size={13} aria-hidden /> Showing cached data. Live prices are delayed.
          </p>
        )}
        {online && hasData && error && (
          <p role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            <span>{error} Showing the last prices received.</span>
            <button type="button" onClick={reload} className="inline-flex shrink-0 items-center gap-1 font-semibold underline">
              <RefreshCw size={11} aria-hidden /> Retry
            </button>
          </p>
        )}

        <div role="table" aria-label="Market prices" className="glass rounded-2xl">
          <div role="rowgroup" className="hidden md:block">
            <div role="row" className={cx('sticky top-[5.5rem] z-10 grid items-center gap-3 rounded-t-2xl border-b border-border bg-panel/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted backdrop-blur', COLS)}>
              {HEADERS.map((h) => {
                const active = h.key !== null && sort.key === h.key;
                return h.key ? (
                  <button
                    key={h.label}
                    role="columnheader"
                    type="button"
                    onClick={() => toggleSort(h.key!)}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cx('inline-flex items-center gap-1 uppercase hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', h.align === 'text-right' ? 'justify-end' : 'justify-start', active && 'text-text-primary')}
                  >
                    {h.label}
                    {active && (sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                  </button>
                ) : (
                  <span key={h.label} role="columnheader" className={h.align}>
                    {h.label}
                  </span>
                );
              })}
            </div>
          </div>
          <div role="rowgroup">
            {(loading && !hasData) || moversLoading ? (
              <div role="status" aria-busy="true" aria-label="Loading markets" className="space-y-3 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : !hasData ? (
              <div role="alert" className="p-8 text-center">
                <p className="text-sm font-semibold">{error ? "Couldn't load market data" : 'No market data yet'}</p>
                {error && <p className="mt-1 text-xs text-text-muted">{error}</p>}
                <button type="button" onClick={reload} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
                  <RefreshCw size={14} aria-hidden /> Retry
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold">{q ? `No symbols match "${q}"` : 'Nothing to show here yet'}</p>
                {q && (
                  <button type="button" onClick={() => onSearch('')} className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              rows.slice(0, shown).map((s) => <Row key={s.symbol} s={s} />)
            )}
          </div>
        </div>

        {rows.length > shown && (
          <div className="flex justify-center">
            <button type="button" onClick={() => setShown((n) => n + CHUNK)} className="rounded-full border border-border px-5 py-2 text-xs font-semibold text-text-secondary hover:border-accent/50 hover:text-text-primary">
              Show more ({rows.length - shown} remaining)
            </button>
          </div>
        )}
        <p className="px-1 text-center text-[11px] text-text-muted">Prices are for information only and are not financial advice.</p>
      </section>
    </HubShell>
  );
}
