import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is rendered in a portal with fixed positioning: tiles use overflow-hidden, which
  // would clip an absolutely-positioned dropdown. Re-measure on open and close on scroll/resize.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const w = Math.min(220, window.innerWidth - 16);
    const h = menuRef.current?.offsetHeight ?? 300;
    const left = Math.max(8, Math.min(b.right - w, window.innerWidth - w - 8));
    const below = b.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 4) : below;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
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
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-hover hover:text-text-primary md:h-9 md:w-9"
        aria-label={`Actions for ${target.username}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden', width: 'min(220px, calc(100vw - 16px))' }}
            className="z-[60] rounded-lg border border-border bg-panel py-1 shadow-xl"
          >
            {items.map((item) => (
              <div key={item.action}>
                {item.divider && <div className="my-1 border-t border-border" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onAction(item.action, target);
                  }}
                  className={`block min-h-[44px] w-full px-4 py-2 text-left text-sm hover:bg-hover md:min-h-0 md:py-1.5 ${item.danger ? 'text-danger' : 'text-text-primary'}`}
                >
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
