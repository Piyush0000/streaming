import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { compactCount, hubApi, hubPath, type HubCommunity, type HubUser } from '../lib/hub';
import { cx } from '../lib/format';
import { useHubAuth } from '../hooks/useHubAuth';
import Avatar from '../components/Avatar';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import HubShell from '../components/hub/HubShell';
import FeedList, { useFeedView } from '../components/hub/FeedList';
import { CommunityDot, JoinButton } from '../components/hub/HubSidebar';
import { useHubCommunities } from '../components/hub/hubCommunities';

type Tab = 'posts' | 'communities' | 'users';

/** Small fetch-once list for communities/users results. */
function useResults<T>(run: () => Promise<T[]>, key: string, enabled: boolean) {
  const [items, setItems] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setItems(null);
    setFailed(false);
    run()
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);
  return { items, failed, retry: () => setNonce((n) => n + 1) };
}

function ResultState({ items, failed, retry, empty }: { items: unknown[] | null; failed: boolean; retry: () => void; empty: string }) {
  if (failed)
    return (
      <div role="alert" className="glass rounded-2xl p-6 text-center">
        <p className="mb-3 text-sm text-text-secondary">Search failed.</p>
        <button onClick={retry} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  if (items === null)
    return (
      <div role="status" aria-busy="true" aria-label="Searching" className="glass space-y-3 rounded-2xl p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    );
  if (items.length === 0)
    return (
      <div className="glass rounded-2xl">
        <EmptyState character="cat" title={empty} body="Try a different search." />
      </div>
    );
  return null;
}

function CommunityResults({ q, token, enabled }: { q: string; token: string | null; enabled: boolean }) {
  const r = useResults<HubCommunity>(() => hubApi.searchCommunities(token, q), `${q}|${token ? 1 : 0}`, enabled);
  const { communities } = useHubCommunities();
  return (
    <>
      <ResultState {...r} empty="No communities found" />
      {r.items && r.items.length > 0 && (
        <ul className="glass divide-y divide-border/60 rounded-2xl">
          {r.items.map((c) => {
            const live = communities.find((x) => x.slug === c.slug) ?? c;
            return (
              <li key={c.slug} className="flex items-center gap-3 p-3">
                <Link to={hubPath.community(c.slug)} className="flex min-w-0 flex-1 items-center gap-3">
                  <CommunityDot slug={c.slug} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">c/{c.slug}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {compactCount(c.memberCount)} members{c.description ? ` · ${c.description}` : ''}
                    </span>
                  </span>
                </Link>
                <JoinButton community={live} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function UserResults({ q, token, enabled }: { q: string; token: string | null; enabled: boolean }) {
  const r = useResults<HubUser>(() => hubApi.searchUsers(token, q), `${q}|${token ? 1 : 0}`, enabled);
  return (
    <>
      <ResultState {...r} empty="No people found" />
      {r.items && r.items.length > 0 && (
        <ul className="glass divide-y divide-border/60 rounded-2xl">
          {r.items.map((u) => (
            <li key={u.id || u.username}>
              <Link to={hubPath.user(u.username)} className="flex items-center gap-3 p-3 hover:bg-hover/50">
                <Avatar name={u.username} src={u.avatarUrl} preset={u.avatarPreset} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{u.displayName}</span>
                  <span className="block truncate text-xs text-text-muted">u/{u.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function HubSearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  const { token, initializing, requireAuth } = useHubAuth();
  const [tab, setTab] = useState<Tab>('posts');
  const [view] = useFeedView();
  const tabs: [Tab, string][] = [
    ['posts', 'Posts'],
    ['communities', 'Communities'],
    ['users', 'People'],
  ];

  return (
    <HubShell>
      <h1 className="truncate text-lg font-extrabold">{q ? `Results for "${q}"` : 'Search'}</h1>
      <div role="tablist" aria-label="Result type" className="glass flex gap-1 rounded-2xl p-1.5">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              tab === id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-hover'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!q ? (
        <div className="glass rounded-2xl">
          <EmptyState character="wizard" title="Search Elonix Hub" body="Type in the search box above to find posts, communities and people." />
        </div>
      ) : (
        <>
          {tab === 'posts' && (
            <FeedList
              fetchPage={(cursor) => hubApi.searchPosts(token, q, cursor)}
              resetKey={`${q}|${token ? 1 : 0}`}
              enabled={!initializing}
              view={view}
              token={token}
              requireAuth={requireAuth}
              emptyCharacter="cat"
              emptyTitle="No posts found"
              emptyBody="Try a different search."
            />
          )}
          {tab === 'communities' && <CommunityResults q={q} token={token} enabled={!initializing} />}
          {tab === 'users' && <UserResults q={q} token={token} enabled={!initializing} />}
        </>
      )}
    </HubShell>
  );
}
