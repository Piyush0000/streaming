import { useState } from 'react';
import { ChevronDown, UserPlus } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { usePolled } from '../hooks/usePolled';
import { fetchRecentJoins } from '../lib/activity';
import { cx, relativeTime } from '../lib/format';
import Avatar from './Avatar';
import SourceBadge from './SourceBadge';

/**
 * Collapsible "Recent joins" feed (last 24h, newest first). Polls only while
 * expanded. Place anywhere inside the authenticated layout.
 */
export default function RecentJoins({ className, defaultOpen = true }: { className?: string; defaultOpen?: boolean }) {
  const { session } = useSession();
  const [open, setOpen] = useState(defaultOpen);
  const token = session?.accessToken ?? null;
  const { data } = usePolled(async () => (token ? fetchRecentJoins(token, null, 10) : []), 30_000, !!token && open);
  const events = data ?? [];

  return (
    <section className={cx('rounded-lg border border-border bg-panel', className)} aria-label="Recent joins">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
      >
        <UserPlus size={14} className="text-accent" />
        <span className="flex-1">Recent joins</span>
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="space-y-0.5 px-2 pb-2">
          {events.length === 0 && <li className="px-1 py-1.5 text-xs text-text-muted">No new members in the last 24h.</li>}
          {events.map((e) => (
            <li key={e.id} className="flex animate-slide-in-right items-center gap-2 rounded px-1 py-1 hover:bg-hover">
              <Avatar name={e.displayName || e.username} size="sm" src={e.avatarUrl} preset={e.avatarPreset} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{e.displayName || e.username}</span>
              <SourceBadge source={e.source} />
              <span className="shrink-0 text-[11px] text-text-muted">{relativeTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
