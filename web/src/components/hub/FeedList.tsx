import { useEffect, useState, type ReactNode } from 'react';
import { Clock, Flame, LayoutList, RefreshCw, Rows3, TrendingUp, Users } from 'lucide-react';
import { readPref, writePref, type HubSort, type HubTime, type Page, type HubPost } from '../../lib/hub';
import { cx } from '../../lib/format';
import { useInfinite } from '../../hooks/useInfinite';
import { useToast } from '../../context/ToastContext';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import type { PresetId } from '../characters/characters';
import PostCard, { type FeedView } from './PostCard';

const VIEW_KEY = 'streaming.hub.view';

export function useFeedView(): [FeedView, (v: FeedView) => void] {
  const [view, setView] = useState<FeedView>(() => (readPref(VIEW_KEY, 'card') === 'compact' ? 'compact' : 'card'));
  useEffect(() => writePref(VIEW_KEY, view), [view]);
  return [view, setView];
}

export function PostSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="glass flex gap-3 rounded-2xl p-3" aria-hidden>
      <div className="flex w-6 flex-col items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-3 w-5" />
        <Skeleton className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-4 w-3/4" />
        {!compact && <Skeleton className="h-40 w-full rounded-xl" />}
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

const SORTS: { value: HubSort; label: string; Icon: typeof Flame }[] = [
  { value: 'hot', label: 'Hot', Icon: Flame },
  { value: 'new', label: 'New', Icon: Clock },
  { value: 'top', label: 'Top', Icon: TrendingUp },
];
const TIMES: { value: HubTime; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

export function FeedControls({
  sort,
  onSort,
  time,
  onTime,
  view,
  onView,
  joined,
  onJoined,
}: {
  sort: HubSort;
  onSort: (s: HubSort) => void;
  time: HubTime;
  onTime: (t: HubTime) => void;
  view: FeedView;
  onView: (v: FeedView) => void;
  /** undefined hides the toggle (logged out / not applicable). */
  joined?: boolean;
  onJoined?: (v: boolean) => void;
}) {
  const tab = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
      <div role="tablist" aria-label="Sort posts" className="flex items-center gap-1">
        {SORTS.map(({ value, label, Icon }) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={sort === value}
            onClick={() => onSort(value)}
            className={cx(tab, sort === value ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-hover hover:text-text-primary')}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {sort === 'top' && (
        <select
          value={time}
          onChange={(e) => onTime(e.target.value as HubTime)}
          aria-label="Time range"
          className="rounded-lg border border-border bg-base px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {TIMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      {joined !== undefined && onJoined && (
        <button
          type="button"
          aria-pressed={joined}
          onClick={() => onJoined(!joined)}
          className={cx(tab, joined ? 'bg-success/15 text-success' : 'text-text-secondary hover:bg-hover')}
        >
          <Users size={15} /> Joined
        </button>
      )}
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="Layout">
        {([
          ['card', 'Card view', LayoutList],
          ['compact', 'Compact view', Rows3],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            aria-label={label}
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={cx('rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', view === v ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-hover')}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  fetchPage: (cursor: string | null) => Promise<Page<HubPost>>;
  resetKey: string;
  view: FeedView;
  token: string | null;
  requireAuth: () => boolean;
  enabled?: boolean;
  emptyTitle: string;
  emptyBody?: ReactNode;
  emptyCharacter?: PresetId;
  emptyAction?: ReactNode;
}

/** Infinite post list with skeletons, empty and error states. */
export default function FeedList({ fetchPage, resetKey, view, token, requireAuth, enabled = true, emptyTitle, emptyBody, emptyCharacter = 'fox', emptyAction }: Props) {
  const { showToast } = useToast();
  const feed = useInfinite<HubPost>(fetchPage, resetKey, enabled, (m) => showToast(m, 'error'));
  const empty = enabled && !feed.loading && !feed.failed && feed.items.length === 0;

  return (
    <div className="space-y-3" aria-live="polite">
      {feed.items.map((p, idx) => (
        <div key={p.id} className="stagger" style={{ ['--i' as string]: Math.min(idx % 12, 6) }}>
          <PostCard
            post={p}
            token={token}
            requireAuth={requireAuth}
            view={view}
            onDeleted={(id) => feed.setItems((prev) => prev.filter((x) => x.id !== id))}
          />
        </div>
      ))}
      {(feed.loading || !enabled) && (
        <div role="status" aria-busy="true" aria-label="Loading posts" className="space-y-3">
          <PostSkeleton compact={view === 'compact'} />
          {feed.items.length === 0 && <PostSkeleton compact={view === 'compact'} />}
        </div>
      )}
      {feed.failed && (
        <div role="alert" className="glass rounded-2xl border-danger/30 p-6 text-center">
          <p className="mb-3 text-sm text-text-secondary">Couldn't load posts.</p>
          <button
            type="button"
            onClick={feed.retry}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-hover"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}
      {empty && (
        <div className="glass rounded-2xl">
          <EmptyState character={emptyCharacter} title={emptyTitle} body={emptyBody}>
            {emptyAction}
          </EmptyState>
        </div>
      )}
      {feed.done && feed.items.length > 0 && <p className="py-4 text-center text-xs text-text-muted">You're all caught up.</p>}
      <div ref={feed.sentinel} className="h-1" />
    </div>
  );
}
