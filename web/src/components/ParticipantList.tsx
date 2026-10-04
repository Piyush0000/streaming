import { ReactNode } from 'react';
import { Headphones } from 'lucide-react';
import Avatar from './Avatar';
import type { Participant } from '../hooks/useStreamMedia';
import { useLeavingList } from '../hooks/useLeavingList';

/** Everyone who's listening. Each row shows the person's role; hosts/admins get an action slot. */
export default function ParticipantList({
  listeners,
  renderActions,
}: {
  listeners: Participant[];
  renderActions?: (p: Participant) => ReactNode;
}) {
  const rows = useLeavingList(listeners, (p) => p.userId, 180);
  return (
    <section aria-label="Listeners">
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <Headphones size={13} /> Listeners ({listeners.length})
      </h2>
      {listeners.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
          No listeners yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ item: p, leaving }) => (
            <li
              key={p.userId}
              aria-hidden={leaving || undefined}
              className={`flex items-center gap-2.5 rounded-lg border border-border bg-panel px-2.5 py-2 ${
                leaving ? 'pointer-events-none animate-pop-out' : 'animate-pop-in'
              }`}
            >
              <Avatar name={p.username || 'Guest'} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {p.username || 'Guest'}
                {p.isSelf && <span className="ml-1 text-xs text-text-muted">(you)</span>}
              </span>
              <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Listener
              </span>
              {!p.isSelf && renderActions?.(p)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
