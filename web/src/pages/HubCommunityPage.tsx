import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { gradientForSlug, hubApi, hubPath, compactCount, type HubCommunity, type HubSort, type HubTime } from '../lib/hub';
import { ApiError } from '../lib/api';
import { useHubAuth } from '../hooks/useHubAuth';
import HubShell from '../components/hub/HubShell';
import FeedList, { FeedControls, useFeedView } from '../components/hub/FeedList';
import { useHubCommunities } from '../components/hub/hubCommunities';
import { CommunityDot } from '../components/hub/HubSidebar';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

function Header({ slug }: { slug: string }) {
  const { token, initializing } = useHubAuth();
  const { toggleJoin } = useHubCommunities();
  const [community, setCommunity] = useState<HubCommunity | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (initializing) return;
    let cancelled = false;
    setState('loading');
    hubApi
      .getCommunity(token, slug)
      .then((c) => {
        if (cancelled) return;
        setCommunity({ ...c, slug: c.slug || slug });
        setState('ok');
      })
      .catch((err) => {
        if (!cancelled) setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, token, initializing, nonce]);

  if (state === 'loading')
    return (
      <div className="glass overflow-hidden rounded-2xl" role="status" aria-busy="true" aria-label="Loading community">
        <Skeleton className="h-24 rounded-none" />
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    );
  if (state === 'missing')
    return (
      <div className="glass rounded-2xl">
        <EmptyState character="bear" title="Community not found" body={`There is no c/${slug} yet.`}>
          <Link to={hubPath.home} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Back to the hub
          </Link>
        </EmptyState>
      </div>
    );
  if (state === 'error' || !community)
    return (
      <div role="alert" className="glass rounded-2xl p-6 text-center">
        <p className="mb-3 text-sm text-text-secondary">Couldn't load this community.</p>
        <button onClick={() => setNonce((n) => n + 1)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
          Retry
        </button>
      </div>
    );

  async function join() {
    if (!community) return;
    const r = await toggleJoin(community.slug, community.joined);
    if (r !== null)
      setCommunity((c) => (c ? { ...c, joined: r, memberCount: Math.max(0, c.memberCount + (r === c.joined ? 0 : r ? 1 : -1)) } : c));
  }

  return (
    <header className="glass animate-rise-in overflow-hidden rounded-2xl">
      <div className="h-24 sm:h-28" style={{ background: gradientForSlug(community.slug) }} aria-hidden />
      <div className="px-4 pb-4">
        <div className="-mt-7 flex items-end gap-3">
          <div className="rounded-full ring-4 ring-panel">
            <CommunityDot slug={community.slug} size={56} />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-xl font-extrabold">{community.name}</h1>
            <p className="text-xs text-text-muted">c/{community.slug}</p>
          </div>
          <button
            type="button"
            onClick={() => void join()}
            aria-pressed={community.joined}
            className={
              community.joined
                ? 'mb-1 rounded-full border border-border px-5 py-2 text-sm font-semibold text-text-secondary hover:border-danger/50 hover:text-danger'
                : 'cta-border mb-1 rounded-full px-5 py-2 text-sm font-semibold text-white'
            }
          >
            {community.joined ? 'Joined' : 'Join'}
          </button>
        </div>
        {community.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-text-secondary">{community.description}</p>}
        <p className="mt-2 text-xs text-text-muted">
          <strong className="text-text-primary">{compactCount(community.memberCount)}</strong> members ·{' '}
          <strong className="text-text-primary">{compactCount(community.postCount)}</strong> posts
        </p>
      </div>
    </header>
  );
}

export default function HubCommunityPage() {
  const { slug = '' } = useParams();
  const { token, initializing, requireAuth } = useHubAuth();
  const [sort, setSort] = useState<HubSort>('hot');
  const [time, setTime] = useState<HubTime>('day');
  const [view, setView] = useFeedView();

  return (
    <HubShell>
      <Header slug={slug} />
      <div className="flex justify-end">
        <Link
          to={`${hubPath.submit}?community=${encodeURIComponent(slug)}`}
          onClick={(e) => {
            if (!requireAuth()) e.preventDefault();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:border-accent/40 hover:text-text-primary"
        >
          <Plus size={15} /> Post in c/{slug}
        </Link>
      </div>
      <FeedControls sort={sort} onSort={setSort} time={time} onTime={setTime} view={view} onView={setView} />
      <FeedList
        fetchPage={(cursor) => hubApi.listPosts(token, { sort, t: time, community: slug, cursor })}
        resetKey={`${slug}|${sort}|${time}|${token ? 1 : 0}`}
        enabled={!initializing}
        view={view}
        token={token}
        requireAuth={requireAuth}
        emptyTitle="No posts here yet"
        emptyBody={`Start the conversation in c/${slug}.`}
      />
    </HubShell>
  );
}
