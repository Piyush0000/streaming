import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowBigUp, CalendarDays, MoreHorizontal, RefreshCw } from 'lucide-react';
import { compactCount, hubApi, hubPath, timeAgo, type HubUser, type HubUserComment } from '../lib/hub';
import { ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { useInfinite } from '../hooks/useInfinite';
import { useHubAuth } from '../hooks/useHubAuth';
import { useToast } from '../context/ToastContext';
import Avatar from '../components/Avatar';
import { useUserCard } from '../components/UserCard';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import HubShell from '../components/hub/HubShell';
import ShareButton from '../components/hub/ShareButton';
import FeedList, { PostSkeleton, useFeedView } from '../components/hub/FeedList';
import Markdown from '../components/hub/Markdown';

type Tab = 'posts' | 'comments' | 'saved';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-base/50 px-3 py-2 text-center">
      <div className="text-base font-extrabold tabular-nums">{compactCount(value)}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}

function CommentsTab({ username, token, enabled }: { username: string; token: string | null; enabled: boolean }) {
  const { showToast } = useToast();
  const feed = useInfinite<HubUserComment>((c) => hubApi.userComments(token, username, c), `${username}|${token ? 1 : 0}`, enabled, (m) => showToast(m, 'error'));
  return (
    <div className="space-y-3" aria-live="polite">
      {feed.items.map((c, i) => (
        <article key={c.id} className="glass stagger rounded-2xl p-3" style={{ ['--i' as string]: Math.min(i % 12, 6) }}>
          {c.post && (
            <p className="mb-1 text-xs text-text-muted">
              Commented on{' '}
              <Link to={`${hubPath.post(c.post.id)}#comment-${c.id}`} className="font-semibold text-text-primary hover:text-accent hover:underline">
                {c.post.title}
              </Link>
              {c.post.community && (
                <>
                  {' '}in{' '}
                  <Link to={hubPath.community(c.post.community.slug)} className="font-semibold hover:text-accent hover:underline">
                    c/{c.post.community.slug}
                  </Link>
                </>
              )}
            </p>
          )}
          {c.deleted ? <p className="text-sm italic text-text-muted">[deleted]</p> : <Markdown text={c.body} />}
          <p className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <span className="inline-flex items-center gap-0.5"><ArrowBigUp size={14} /> {compactCount(c.score)}</span>
            <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          </p>
        </article>
      ))}
      {feed.loading && (
        <div role="status" aria-busy="true" aria-label="Loading comments">
          <PostSkeleton compact />
        </div>
      )}
      {feed.failed && (
        <div role="alert" className="glass rounded-2xl p-6 text-center">
          <p className="mb-3 text-sm text-text-secondary">Couldn't load comments.</p>
          <button type="button" onClick={feed.retry} className="tap inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}
      {enabled && !feed.loading && !feed.failed && feed.items.length === 0 && (
        <div className="glass rounded-2xl">
          <EmptyState character="cat" title="No comments yet" />
        </div>
      )}
      <div ref={feed.sentinel} className="h-1" />
    </div>
  );
}

export default function HubProfilePage() {
  const { username = '' } = useParams();
  const { token, initializing, username: me, requireAuth } = useHubAuth();
  const { openUserCard } = useUserCard();
  const [user, setUser] = useState<HubUser | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<Tab>('posts');
  const [view, setView] = useFeedView();
  void setView;

  useEffect(() => {
    if (initializing) return;
    let cancelled = false;
    setState('loading');
    hubApi
      .getUser(token, username)
      .then((u) => {
        if (cancelled) return;
        setUser({ ...u, username: u.username || username });
        setState('ok');
      })
      .catch((err) => {
        if (!cancelled) setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [username, token, initializing, nonce]);

  useEffect(() => setTab('posts'), [username]);

  const own = !!user && !!me && me.toLowerCase() === user.username.toLowerCase();
  const tabs: { id: Tab; label: string }[] = [
    { id: 'posts', label: 'Posts' },
    { id: 'comments', label: 'Comments' },
    ...(own ? [{ id: 'saved' as Tab, label: 'Saved' }] : []),
  ];

  return (
    <HubShell>
      {state === 'loading' && (
        <div className="glass rounded-2xl p-5" role="status" aria-busy="true" aria-label="Loading profile">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      )}
      {state === 'missing' && (
        <div className="glass rounded-2xl">
          <EmptyState character="robot" title="User not found" body={`There is no u/${username}.`}>
            <Link to={hubPath.home} className="tap inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Back to the hub
            </Link>
          </EmptyState>
        </div>
      )}
      {state === 'error' && (
        <div role="alert" className="glass rounded-2xl p-6 text-center">
          <p className="mb-3 text-sm text-text-secondary">Couldn't load this profile.</p>
          <button type="button" onClick={() => setNonce((n) => n + 1)} className="tap rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
            Retry
          </button>
        </div>
      )}

      {state === 'ok' && user && (
        <>
          <header className="glass animate-rise-in overflow-hidden rounded-2xl">
            <div className="h-20 bg-gradient-to-r from-accent/40 via-violet-500/30 to-fuchsia-500/20" aria-hidden />
            <div className="px-4 pb-4 sm:px-5">
              <div className="-mt-10 flex items-end gap-3">
                <div className="rounded-full ring-4 ring-panel">
                  <Avatar name={user.username} src={user.avatarUrl} preset={user.avatarPreset} size={80} glow />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <h1 className="truncate text-xl font-extrabold">{user.displayName}</h1>
                  <p className="truncate text-sm text-text-muted">u/{user.username}</p>
                </div>
                <ShareButton
                  url={hubPath.user(user.username)}
                  title={`u/${user.username} on Elonix Hub`}
                  showLabel={false}
                  iconSize={18}
                  className="mb-1 inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-2 text-text-secondary hover:bg-hover hover:text-text-primary"
                />
                {!own && user.id && (
                  <button
                    type="button"
                    aria-label="More actions"
                    onClick={() => requireAuth() && openUserCard(user.id, user.username)}
                    className="tap mb-1 inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-2 text-text-secondary hover:bg-hover hover:text-text-primary"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </div>
              {user.bio && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-text-secondary">{user.bio}</p>}
              {user.joinedAt && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                  <CalendarDays size={13} /> Joined {new Date(user.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Post karma" value={user.postKarma} />
                <Stat label="Comment karma" value={user.commentKarma} />
                <Stat label="Posts" value={user.postCount} />
                <Stat label="Comments" value={user.commentCount} />
              </div>
            </div>
          </header>

          <div role="tablist" aria-label="Profile sections" className="glass flex gap-1 rounded-2xl p-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  'tap flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  tab === t.id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-hover'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'posts' && (
            <FeedList
              fetchPage={(c) => hubApi.userPosts(token, user.username, c)}
              resetKey={`posts|${user.username}|${token ? 1 : 0}`}
              view={view}
              token={token}
              requireAuth={requireAuth}
              emptyCharacter="whale"
              emptyTitle="No posts yet"
              emptyBody={own ? 'Share your first trade or thought.' : `u/${user.username} hasn't posted anything.`}
            />
          )}
          {tab === 'comments' && <CommentsTab username={user.username} token={token} enabled />}
          {tab === 'saved' && own && token && (
            <FeedList
              fetchPage={(c) => hubApi.listSaved(token, c)}
              resetKey={`saved|${token}`}
              view={view}
              token={token}
              requireAuth={requireAuth}
              emptyCharacter="gem"
              emptyTitle="Nothing saved yet"
              emptyBody="Use Save on any post to find it here later."
            />
          )}
        </>
      )}
    </HubShell>
  );
}
