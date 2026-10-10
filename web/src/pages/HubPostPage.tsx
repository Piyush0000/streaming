import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { hubApi, hubPath, type HubPost } from '../lib/hub';
import { ApiError } from '../lib/api';
import { canGoBackInApp } from '../lib/nav';
import { useHubAuth } from '../hooks/useHubAuth';
import HubShell from '../components/hub/HubShell';
import PostCard from '../components/hub/PostCard';
import Comments from '../components/hub/Comments';
import { PostSkeleton } from '../components/hub/FeedList';
import EmptyState from '../components/EmptyState';

export default function HubPostPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { token, initializing, requireAuth } = useHubAuth();
  const [post, setPost] = useState<HubPost | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  const rootId = search.get('root');

  useEffect(() => {
    if (initializing) return;
    let cancelled = false;
    setState('loading');
    hubApi
      .getPost(token, id)
      .then((p) => {
        if (cancelled) return;
        setPost({ ...p, id: p.id || id });
        setState('ok');
      })
      .catch((err) => {
        if (!cancelled) setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [id, token, initializing, nonce]);

  return (
    <HubShell>
      <div>
        <button
          type="button"
          onClick={() => (canGoBackInApp() ? navigate(-1) : navigate(hubPath.home))}
          className="tap inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
        >
          <ArrowLeft size={15} /> Back
        </button>
      </div>

      {state === 'loading' && <div role="status" aria-busy="true" aria-label="Loading post"><PostSkeleton /></div>}
      {state === 'missing' && (
        <div className="glass rounded-2xl">
          <EmptyState character="bear" title="Post not found" body="It may have been deleted.">
            <Link to={hubPath.home} className="tap inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Back to the hub
            </Link>
          </EmptyState>
        </div>
      )}
      {state === 'error' && (
        <div role="alert" className="glass rounded-2xl p-6 text-center">
          <p className="mb-3 text-sm text-text-secondary">Couldn't load this post.</p>
          <button type="button" onClick={() => setNonce((n) => n + 1)} className="tap rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
            Retry
          </button>
        </div>
      )}
      {state === 'ok' && post && (
        <>
          <div className="animate-rise-in">
            <PostCard post={post} token={token} requireAuth={requireAuth} detail onDeleted={() => navigate(hubPath.home, { replace: true })} />
          </div>
          <Comments
            postId={post.id}
            token={token}
            requireAuth={requireAuth}
            rootId={rootId}
            onCountChange={(d) => setPost((p) => (p ? { ...p, commentCount: Math.max(0, p.commentCount + d) } : p))}
          />
        </>
      )}
    </HubShell>
  );
}
