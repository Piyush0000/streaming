import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { hubApi, HubPost, HubSide } from '../lib/hub';
import { rememberPostLoginPath } from '../lib/redirect';
import HubNav from '../components/hub/HubNav';
import PostCard from '../components/hub/PostCard';
import Composer from '../components/hub/Composer';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedBackground from '../components/AnimatedBackground';

function PostSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-panel" role="status" aria-busy="true" aria-label="Loading posts">
      <div className="flex items-center gap-3 p-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
      <Skeleton className="aspect-video rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export default function ElonixHubPage() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { session, initializing } = useSession();
  const { showToast } = useToast();
  const token = session?.accessToken ?? null;
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [composer, setComposer] = useState(false);
  const [prefill, setPrefill] = useState<{ symbol?: string; side?: HubSide; pnlPercent?: number } | undefined>(undefined);
  const prefillHandled = useRef(false);
  const inflight = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const requireAuth = useCallback((): boolean => {
    if (token) return true;
    rememberPostLoginPath('/elonixhub');
    showToast('Sign in to join in.', 'info');
    navigate('/login', { state: { from: '/elonixhub' } });
    return false;
  }, [token, navigate, showToast]);

  // "Share to Elonix Hub" from paper trading: router state prefills the composer (state is validated, never trusted).
  useEffect(() => {
    if (prefillHandled.current || !token) return;
    const share = (routeLocation.state as { share?: unknown } | null)?.share as
      | { symbol?: unknown; side?: unknown; pnlPercent?: unknown }
      | undefined;
    if (!share || typeof share !== 'object') return;
    prefillHandled.current = true;
    const symbol = typeof share.symbol === 'string' && /^[A-Z0-9]{2,20}$/.test(share.symbol) ? share.symbol : undefined;
    const side = share.side === 'long' || share.side === 'short' ? share.side : undefined;
    const pnl = typeof share.pnlPercent === 'number' && Number.isFinite(share.pnlPercent) && Math.abs(share.pnlPercent) <= 100000 ? share.pnlPercent : undefined;
    setPrefill({ symbol, side, pnlPercent: pnl });
    setComposer(true);
    // consume the one-shot state so a refresh does not reopen the composer
    navigate(routeLocation.pathname, { replace: true, state: null });
  }, [token, routeLocation.state, routeLocation.pathname, navigate]);

  const load = useCallback(
    async (reset: boolean, from: string | null) => {
      if (inflight.current) return;
      inflight.current = true;
      setLoading(true);
      setFailed(false);
      try {
        const res = await hubApi.listPosts(token, from);
        setPosts((prev) => (reset ? res.posts : [...prev, ...res.posts.filter((p) => !prev.some((x) => x.id === p.id))]));
        setCursor(res.nextCursor);
        setDone(!res.nextCursor);
      } catch (err) {
        setFailed(true);
        showToast(err instanceof Error ? err.message : 'Could not load posts.', 'error');
      } finally {
        inflight.current = false;
        setLoading(false);
      }
    },
    [token, showToast]
  );

  // Initial (and post-login) load; wait for session restore so the first request carries the token.
  useEffect(() => {
    if (initializing) return;
    setPosts([]);
    setCursor(null);
    setDone(false);
    inflight.current = false;
    void load(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializing, token]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loading && !failed && !done) void load(false, cursor);
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, failed, done, load]);

  const empty = !loading && !failed && posts.length === 0;

  return (
    <div className="relative min-h-[100dvh] animate-page-in bg-base text-text-primary">
      <div className="pointer-events-none fixed inset-0 z-0">
        <AnimatedBackground variant="particles" subtle />
      </div>
      <div className="relative z-10">
      <HubNav />
      <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-gradient-anim text-xl font-extrabold sm:text-2xl">Elonix Hub</h1>
            <p className="text-sm text-text-secondary">Community trades, straight from the screen.</p>
          </div>
          <button
            onClick={() => requireAuth() && setComposer(true)}
            className="cta-border inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Plus size={16} /> Share a trade
          </button>
        </div>

        {posts.map((p, idx) => (
          <div key={p.id} className="stagger" style={{ ['--i' as string]: Math.min(idx % 10, 6) }}>
            <PostCard
              post={p}
              token={token}
              requireAuth={requireAuth}
              onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
            />
          </div>
        ))}

        {(loading || initializing) && (
          <>
            <PostSkeleton />
            {posts.length === 0 && <PostSkeleton />}
          </>
        )}

        {failed && (
          <div className="rounded-2xl border border-danger/30 bg-panel p-6 text-center">
            <p className="mb-3 text-sm text-text-secondary">Couldn't load the feed.</p>
            <button
              onClick={() => void load(posts.length === 0, posts.length === 0 ? null : cursor)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {empty && !initializing && (
          <div className="rounded-2xl border border-border bg-panel">
            <EmptyState character="fox" title="No trades shared yet" body="Be the first to post a screenshot.">
              <button onClick={() => requireAuth() && setComposer(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
                Share a trade
              </button>
            </EmptyState>
          </div>
        )}

        {done && posts.length > 0 && <p className="py-4 text-center text-xs text-text-muted">You're all caught up.</p>}
        <div ref={sentinel} className="h-1" />
      </main>

      {composer && token && (
        <Composer
          token={token}
          initial={prefill}
          onClose={() => { setComposer(false); setPrefill(undefined); }}
          onCreated={(post) => {
            setPosts((prev) => [post, ...prev]); setPrefill(undefined);
            setComposer(false);
          }}
        />
      )}
      </div>
    </div>
  );
}
