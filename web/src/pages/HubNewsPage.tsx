import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import HubShell from '../components/hub/HubShell';
import ShareButton from '../components/hub/ShareButton';
import { MoversMini, OverviewPanel, useOverview } from '../components/hub/MarketWidgets';
import Skeleton from '../components/Skeleton';
import { fetchNews, safeRelative, type NewsCategory, type NewsItem, type NewsSource } from '../lib/hubMarket';
import { cx, relativeTime } from '../lib/format';

const CATEGORIES: Array<{ id: NewsCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'markets', label: 'Markets' },
  { id: 'world', label: 'World' },
];

const CHIP: Record<string, string> = {
  crypto: 'bg-amber-500/15 text-amber-300',
  markets: 'bg-accent/15 text-accent',
  world: 'bg-emerald-500/15 text-emerald-300',
};

function trim(s: string, n = 220): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

function NewsCard({ item }: { item: NewsItem }) {
  const when = safeRelative(item.publishedAt, relativeTime);
  return (
    <article className="glass glass-glow rounded-2xl p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-md border border-border bg-panel/70 px-1.5 py-0.5 font-semibold text-text-secondary">{item.source}</span>
        <span className={cx('rounded-md px-1.5 py-0.5 font-semibold capitalize', CHIP[item.category] ?? 'bg-hover text-text-secondary')}>{item.category}</span>
        {when && <time dateTime={item.publishedAt ?? undefined} className="text-text-muted">{when}</time>}
      </div>
      <h3 className="text-sm font-bold leading-snug sm:text-base">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-start gap-1.5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>{item.title}</span>
          <ExternalLink size={13} aria-hidden className="mt-1 shrink-0 text-text-muted" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </h3>
      {item.summary && <p className="mt-1.5 text-xs leading-relaxed text-text-secondary sm:text-sm">{trim(item.summary)}</p>}
      <div className="mt-2 flex items-center gap-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="tap inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Read article <ExternalLink size={12} aria-hidden />
        </a>
        <ShareButton
          url={item.url}
          title={item.title}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
    </article>
  );
}

function NewsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading news" className="space-y-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="glass space-y-2 rounded-2xl p-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function SourcesPopover({ sources }: { sources: NewsSource[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (sources.length === 0) return null;
  const failed = sources.filter((s) => !s.ok).length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="tap inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', failed ? 'bg-warning' : 'bg-success')} />
        Sources {sources.length - failed}/{sources.length}
        <ChevronDown size={12} aria-hidden className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="glass absolute right-0 z-20 mt-1 w-52 animate-slide-down space-y-1 rounded-xl p-2 text-xs shadow-xl">
          {sources.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2 px-1">
              <span className="truncate">{s.name}</span>
              <span className={s.ok ? 'text-success' : 'text-danger'}>{s.ok ? 'OK' : 'Failed'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function HubNewsPage() {
  const [category, setCategory] = useState<NewsCategory>('all');
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), 350);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [stale, setStale] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reqId = useRef(0);
  const { data: overview, loading: overviewLoading } = useOverview();

  // First page: refetch whenever the filters change.
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchNews({ category, q }, ctrl.signal)
      .then((page) => {
        if (id !== reqId.current) return;
        setItems(page.items);
        setSources(page.sources);
        setStale(page.stale);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (id !== reqId.current || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'Could not load news.');
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [category, q, reloadTick]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || loading) return;
    const id = reqId.current;
    setLoadingMore(true);
    fetchNews({ category, q, cursor })
      .then((page) => {
        if (id !== reqId.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setSources(page.sources.length ? page.sources : sources);
        setStale((s) => s || page.stale);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (id === reqId.current) setError(err instanceof Error ? err.message : 'Could not load more.');
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, loading, category, q, sources]);

  // Auto-load when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && loadMore(), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const retry = () => setReloadTick((t) => t + 1);
  const hasItems = items.length > 0;

  return (
    <HubShell sidebar={false} wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-label="News" className="min-w-0 space-y-3">
          <div className="glass space-y-3 rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="News category" className="scrollbar-none flex min-w-0 basis-full gap-1 overflow-x-auto sm:flex-1 sm:basis-0">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    type="button"
                    aria-selected={category === c.id}
                    onClick={() => setCategory(c.id)}
                    className={cx(
                      'tap shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-xs',
                      category === c.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <SourcesPopover sources={sources} />
            </div>
            <div className="relative">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 100))}
                type="search"
                aria-label="Search headlines"
                placeholder="Search headlines"
                enterKeyHint="search"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-full border border-border bg-base/60 py-2 pl-9 pr-11 text-sm outline-none transition-colors focus:border-accent sm:min-h-0 sm:pr-9"
              />
              {input && (
                <button type="button" onClick={() => setInput('')} aria-label="Clear search" className="tap absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1.5 text-text-secondary hover:text-text-primary sm:right-1">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {stale && hasItems && (
            <p role="status" className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
              <AlertTriangle size={12} aria-hidden /> Showing cached data
            </p>
          )}

          {error && hasItems && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <span>{error} Showing the last loaded headlines.</span>
              <button type="button" onClick={retry} className="tap inline-flex shrink-0 items-center gap-1 font-semibold underline">
                <RefreshCw size={11} aria-hidden /> Retry
              </button>
            </div>
          )}

          {loading && !hasItems ? (
            <NewsSkeleton />
          ) : error && !hasItems ? (
            <div role="alert" className="glass rounded-2xl p-8 text-center">
              <p className="text-sm font-semibold">Couldn't load news</p>
              <p className="mt-1 text-xs text-text-muted">{error}</p>
              <button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
                <RefreshCw size={14} aria-hidden /> Retry
              </button>
            </div>
          ) : !hasItems ? (
            <div className="glass rounded-2xl p-8 text-center">
              <p className="text-sm font-semibold">{q ? `No headlines match "${q}"` : 'No headlines yet'}</p>
              <p className="mt-1 text-xs text-text-muted">{q ? 'Try a different search or category.' : 'Check back in a moment.'}</p>
              {q && (
                <button type="button" onClick={() => setInput('')} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <>
              <div className={cx('space-y-3 transition-opacity', loading && 'opacity-60')}>
                {items.map((it) => (
                  <NewsCard key={it.id} item={it} />
                ))}
              </div>
              {loadingMore && <NewsSkeleton />}
              {cursor && !loadingMore && (
                <div ref={sentinel} className="flex justify-center py-2">
                  <button type="button" onClick={loadMore} className="tap rounded-full border border-border px-5 py-2 text-sm font-semibold text-text-secondary hover:border-accent/50 hover:text-text-primary">
                    Load more
                  </button>
                </div>
              )}
              {!cursor && <p className="py-2 text-center text-xs text-text-muted">You're all caught up.</p>}
            </>
          )}
          <p className="px-1 text-center text-[11px] text-text-muted">Headlines link to their original publishers.</p>
        </section>

        <aside aria-label="Market overview" className="min-w-0 space-y-3 lg:sticky lg:top-[calc(var(--hub-nav-h,5.5rem)+1rem)] lg:self-start">
          <OverviewPanel overview={overview} loading={overviewLoading} />
          <MoversMini />
        </aside>
      </div>
    </HubShell>
  );
}
