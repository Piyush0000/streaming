import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff, Plus, RefreshCw } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { hubApi, HubPost } from '../lib/hub';
import { rememberPostLoginPath } from '../lib/redirect';
import HubNav from '../components/hub/HubNav';
import PostCard from '../components/hub/PostCard';
import Composer from '../components/hub/Composer';
import Skeleton from '../components/Skeleton';

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
  const { session, initializing } = useSession();
  const { showToast } = useToast();
  const token = session?.accessToken ?? null;
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [composer, setComposer] = useState(false);
  const inflight = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const requireAuth = useCallback((): boolean => {
    if (token) return true;
    rememberPostLoginPath('/elonixhub');
    showToast('Sign in to join in.', 'info');
    navigate('/login', { state: { from: '/elonixhub' } });
    return false;
  }, [token, navigate, showToast]);

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
    <div className="min-h-[100dvh] animate-page-in bg-base text-text-primary">
      <HubNav />
      <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold sm:text-2xl">Elonix Hub</h1>
            <p className="text-sm text-text-secondary">Community trades, straight from the screen.</p>
          </div>
          <button
            onClick={() => requireAuth() && setComposer(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            <Plus size={16} /> Share a trade
          </button>
        </div>

        {posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            token={token}
            requireAuth={requireAuth}
            onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
          />
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
          <div className="rounded-2xl border border-border bg-panel p-10 text-center">
            <ImageOff className="mx-auto mb-3 text-text-muted" />
            <p className="mb-1 font-semibold">No trades shared yet</p>
            <p className="mb-4 text-sm text-text-secondary">Be the first to post a screenshot.</p>
            <button onClick={() => requireAuth() && setComposer(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Share a trade
            </button>
          </div>
        )}

        {done && posts.length > 0 && <p className="py-4 text-center text-xs text-text-muted">You're all caught up.</p>}
        <div ref={sentinel} className="h-1" />
      </main>

      {composer && token && (
        <Composer
          token={token}
          onClose={() => setComposer(false)}
          onCreated={(post) => {
            setPosts((prev) => [post, ...prev]);
            setComposer(false);
          }}
        />
      )}
    </div>
  );
}
