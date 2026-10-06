import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Flame, Plus, RefreshCw, Users } from 'lucide-react';
import { compactCount, gradientForSlug, hubPath, type HubCommunity } from '../../lib/hub';
import { cx } from '../../lib/format';
import { useHubAuth } from '../../hooks/useHubAuth';
import Skeleton from '../Skeleton';
import CreateCommunityModal from './CreateCommunityModal';
import { useHubCommunities } from './hubCommunities';

export function CommunityDot({ slug, size = 28 }: { slug: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase text-white"
      style={{ width: size, height: size, background: gradientForSlug(slug) }}
    >
      {slug.slice(0, 1)}
    </span>
  );
}

export function JoinButton({ community, size = 'sm' }: { community: HubCommunity; size?: 'sm' | 'md' }) {
  const { toggleJoin } = useHubCommunities();
  return (
    <button
      type="button"
      onClick={() => void toggleJoin(community.slug)}
      aria-pressed={community.joined}
      className={cx(
        'shrink-0 rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        size === 'sm' ? 'px-3 py-1 text-xs' : 'px-5 py-2 text-sm',
        community.joined ? 'border border-border text-text-secondary hover:border-danger/50 hover:text-danger' : 'bg-accent text-white hover:bg-accent-hover'
      )}
    >
      {community.joined ? 'Joined' : 'Join'}
    </button>
  );
}

function CommunityRows({ list }: { list: HubCommunity[] }) {
  return (
    <ul className="space-y-1">
      {list.map((c) => (
        <li key={c.slug} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-hover/60">
          <Link to={hubPath.community(c.slug)} className="flex min-w-0 flex-1 items-center gap-2">
            <CommunityDot slug={c.slug} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">c/{c.slug}</span>
              <span className="block text-[11px] text-text-muted">{compactCount(c.memberCount)} members</span>
            </span>
          </Link>
          <JoinButton community={c} />
        </li>
      ))}
    </ul>
  );
}

function CommunitiesBody({ onCreate }: { onCreate: () => void }) {
  const { communities, loading, failed, reload } = useHubCommunities();
  if (loading && communities.length === 0)
    return (
      <div role="status" aria-busy="true" aria-label="Loading communities" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    );
  if (failed && communities.length === 0)
    return (
      <div className="text-center text-xs text-text-muted">
        Couldn't load communities.{' '}
        <button type="button" onClick={reload} className="inline-flex items-center gap-1 font-semibold text-accent">
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  if (communities.length === 0) return <p className="text-xs text-text-muted">No communities yet. Be the first to create one.</p>;
  return (
    <>
      <div className="max-h-72 overflow-y-auto pr-1">
        <CommunityRows list={[...communities].sort((a, b) => a.slug.localeCompare(b.slug))} />
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-text-secondary hover:border-accent/50 hover:text-text-primary"
      >
        <Plus size={14} /> Create community
      </button>
    </>
  );
}

/** Desktop right rail. */
export function HubSidebar() {
  const { communities } = useHubCommunities();
  const { token, requireAuth } = useHubAuth();
  const { add } = useHubCommunities();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const trending = [...communities].sort((a, b) => b.memberCount - a.memberCount).filter((c) => c.memberCount > 0).slice(0, 5);

  return (
    <aside aria-label="Sidebar" className="hidden space-y-4 lg:block">
      <section className="glass rounded-2xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Users size={15} className="text-accent" /> Communities
        </h2>
        <CommunitiesBody onCreate={() => requireAuth() && setCreating(true)} />
      </section>
      {trending.length > 0 && (
        <section className="glass rounded-2xl p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
            <Flame size={15} className="text-orange-400" /> Trending communities
          </h2>
          <ol className="space-y-2">
            {trending.map((c, i) => (
              <li key={c.slug}>
                <Link to={hubPath.community(c.slug)} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-hover/60">
                  <span className="w-4 text-xs font-bold text-text-muted">{i + 1}</span>
                  <CommunityDot slug={c.slug} size={22} />
                  <span className="min-w-0 flex-1 truncate font-semibold">c/{c.slug}</span>
                  <span className="text-[11px] text-text-muted">{compactCount(c.memberCount)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-bold">About Elonix Hub</h2>
        <p className="text-xs leading-relaxed text-text-secondary">
          A community for traders to share screenshots, ideas and lessons, and to discuss them in threads.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-text-secondary">
          <li>Be respectful. No harassment or hate.</li>
          <li>No spam, scams or paid promotions.</li>
          <li>Never share other people's private information.</li>
          <li>Nothing here is financial advice. Do your own research.</li>
        </ol>
      </section>
      {creating && token && (
        <CreateCommunityModal
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            add(c);
            setCreating(false);
            navigate(hubPath.community(c.slug));
          }}
        />
      )}
    </aside>
  );
}

/** Mobile: the communities list collapses into a dropdown above the feed. */
export function MobileCommunities() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { token, requireAuth } = useHubAuth();
  const { add } = useHubCommunities();
  const navigate = useNavigate();
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="glass flex w-full items-center justify-between rounded-2xl px-4 py-2.5 text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          <Users size={15} className="text-accent" /> Communities
        </span>
        <ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="glass mt-2 animate-slide-down rounded-2xl p-3">
          <CommunitiesBody onCreate={() => requireAuth() && setCreating(true)} />
        </div>
      )}
      {creating && token && (
        <CreateCommunityModal
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            add(c);
            setCreating(false);
            setOpen(false);
            navigate(hubPath.community(c.slug));
          }}
        />
      )}
    </div>
  );
}
