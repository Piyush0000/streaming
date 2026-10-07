import { logger } from './logger';
import { FEED_SOURCES, FeedSource, NewsItem, mergeItems, parseFeed } from './newsParse';

export * from './newsParse';

// ---------- fetching + cache ----------
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
export const REFRESH_INTERVAL_MS = 5 * 60_000;
const STALE_AFTER_MS = 15 * 60_000;
const UA = 'Mozilla/5.0 (compatible; ElonixHubNews/1.0)';

async function fetchFeedText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) throw new Error('feed too large');
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) throw new Error('feed too large');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

interface SourceState {
  ok: boolean;
  items: NewsItem[]; // last good items for this source
}

const state = new Map<string, SourceState>();
let merged: NewsItem[] = [];
let fetchedAt = 0; // last refresh in which at least one source succeeded
let refreshInflight: Promise<void> | null = null;

export function refreshNews(sources: FeedSource[] = FEED_SOURCES): Promise<void> {
  refreshInflight ??= (async () => {
    const now = Date.now();
    const results = await Promise.allSettled(
      sources.map(async (s) => {
        const items = parseFeed(await fetchFeedText(s.url), s, now);
        if (items.length === 0) throw new Error('no valid items');
        return items;
      })
    );
    let anyOk = false;
    results.forEach((r, idx) => {
      const s = sources[idx];
      const prev = state.get(s.name);
      if (r.status === 'fulfilled') {
        anyOk = true;
        state.set(s.name, { ok: true, items: r.value });
      } else {
        logger.warn({ err: r.reason instanceof Error ? r.reason.message : String(r.reason), source: s.name }, 'news: feed failed');
        state.set(s.name, { ok: false, items: prev?.items ?? [] }); // keep last good items
      }
    });
    if (anyOk) {
      merged = mergeItems([...state.values()].map((v) => v.items), Date.now());
      fetchedAt = Date.now();
    }
  })().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

export interface NewsSnapshot {
  fetchedAt: number;
  stale: boolean;
  sources: { name: string; ok: boolean }[];
  items: NewsItem[];
}

/** Lazy first load; later reads are served from memory (background timer refreshes). Null when nothing was ever fetched. */
export async function getNews(): Promise<NewsSnapshot | null> {
  if (fetchedAt === 0) await refreshNews();
  else if (Date.now() - fetchedAt > REFRESH_INTERVAL_MS + 60_000) void refreshNews().catch(() => undefined);
  if (fetchedAt === 0) return null;
  // Re-apply the age cut-off so very old cached items cannot linger if refreshes keep failing.
  const items = mergeItems([merged], Date.now());
  return {
    fetchedAt,
    stale: Date.now() - fetchedAt > STALE_AFTER_MS,
    sources: FEED_SOURCES.map((s) => ({ name: s.name, ok: state.get(s.name)?.ok ?? false })),
    items,
  };
}

let timer: NodeJS.Timeout | null = null;
export function startNewsRefresh(): void {
  if (timer) return;
  void refreshNews().catch(() => undefined);
  timer = setInterval(() => void refreshNews().catch((err) => logger.error({ err }, 'news: refresh failed')), REFRESH_INTERVAL_MS);
  timer.unref();
}
