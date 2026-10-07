import { Router, Request, Response } from 'express';
import { allowIp } from '../rateLimit';
import { getNews, queryItems, startNewsRefresh, CategoryFilter, NewsSnapshot } from '../newsFeeds';

export const newsRouter = Router();

const PER_MINUTE_LIMIT = 60;
const CATEGORIES = new Set(['all', 'crypto', 'markets', 'world']);

// Background refresh every 5 min (also loads lazily on the first request).
startNewsRefresh();

function envelope(snap: NewsSnapshot) {
  return { fetchedAt: new Date(snap.fetchedAt).toISOString(), stale: snap.stale, sources: snap.sources };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

newsRouter.get('/', async (req: Request, res: Response) => {
  if (!(await allowIp(req, res, 'news', PER_MINUTE_LIMIT))) return;
  const category = str(req.query.category) || 'all';
  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'invalid_category' });
  let limit = 20;
  const limitRaw = str(req.query.limit);
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 50) return res.status(400).json({ error: 'invalid_limit' });
    limit = n;
  }
  const snap = await getNews().catch(() => null);
  if (!snap) return res.status(503).json({ error: 'news_unavailable' });
  const page = queryItems(snap.items, {
    category: category as CategoryFilter,
    q: str(req.query.q),
    limit,
    cursor: str(req.query.cursor) || undefined,
  });
  return res.json({ ...envelope(snap), items: page.items, nextCursor: page.nextCursor });
});

newsRouter.get('/headlines', async (req: Request, res: Response) => {
  if (!(await allowIp(req, res, 'news', PER_MINUTE_LIMIT))) return;
  const snap = await getNews().catch(() => null);
  if (!snap) return res.status(503).json({ error: 'news_unavailable' });
  return res.json({ ...envelope(snap), items: snap.items.slice(0, 10) });
});
