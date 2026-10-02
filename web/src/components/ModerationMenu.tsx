import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { STREAM_MAX_WARNINGS } from '../lib/streamLimits';
import type { PeerRole } from '@streaming/shared-types';

export type ParticipantAction = 'demote' | 'remove' | 'warn' | 'mute' | 'unmute' | 'kick' | 'ban' | 'unban';

export interface ModerationTarget {
  userId: string;
  username: string;
}

/**
 * Per-participant action menu for the host / platform admins: room control
 * (demote, remove) and recorded moderation (warn, mute, kick, ban). Choosing
 * an item hands off to the page, which shows the confirmation dialog.
 */
export default function ModerationMenu({
  target,
  role,
  warnings,
  muted,
  onAction,
}: {
  target: ModerationTarget;
  role: PeerRole;
  /** Current recorded warnings for this user (from the moderation list). */
  warnings: number;
  muted: boolean;
  onAction: (action: ParticipantAction, target: ModerationTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: { action: ParticipantAction; label: string; danger?: boolean; divider?: boolean }[] = [];
  if (role === 'speaker') items.push({ action: 'demote', label: 'Move to listeners' });
  items.push({ action: 'remove', label: 'Remove from room' });
  items.push({ action: 'warn', label: `Warn (${warnings}/${STREAM_MAX_WARNINGS})`, divider: true });
  items.push(muted ? { action: 'unmute', label: 'Unmute chat' } : { action: 'mute', label: 'Mute chat' });
  items.push({ action: 'kick', label: 'Kick', danger: true });
  items.push({ action: 'ban', label: 'Ban', danger: true });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
        aria-label={`Actions for ${target.username}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-lg border border-border bg-panel py-1 shadow-xl"
        >
          {items.map((item) => (
            <div key={item.action}>
              {item.divider && <div className="my-1 border-t border-border" />}
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAction(item.action, target);
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-hover ${item.danger ? 'text-danger' : 'text-text-primary'}`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
