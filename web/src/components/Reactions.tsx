import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Heart, Rocket, Sparkles } from 'lucide-react';

export type ReactionKind = 'heart' | 'fire' | 'rocket' | 'clap';

const KINDS: { kind: ReactionKind; label: string; color: string; Icon: typeof Heart }[] = [
  { kind: 'heart', label: 'Send a heart', color: '#f43f5e', Icon: Heart },
  { kind: 'fire', label: 'Send fire', color: '#f97316', Icon: Flame },
  { kind: 'rocket', label: 'Send a rocket', color: '#60a5fa', Icon: Rocket },
  { kind: 'clap', label: 'Applaud', color: '#fbbf24', Icon: Sparkles },
];

export interface FloatingReaction {
  id: number;
  kind: ReactionKind;
  x: number; // % from the left
  dx: number;
  dy: number;
  rot: number;
}

const MAX_FLOATING = 24;

/**
 * Local-only floating reactions. There is no reaction event on the chat socket, so these are
 * NOT broadcast to other viewers. Items auto-expire and the list is capped.
 */
export function useReactions() {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const idRef = useRef(0);
  const timers = useRef<number[]>([]);

  const fire = useCallback((kind: ReactionKind) => {
    const id = ++idRef.current;
    const item: FloatingReaction = {
      id,
      kind,
      x: 8 + Math.random() * 84,
      dx: Math.round((Math.random() - 0.5) * 120),
      dy: -(180 + Math.round(Math.random() * 140)),
      rot: Math.round((Math.random() - 0.5) * 50),
    };
    setItems((prev) => [...prev.slice(-(MAX_FLOATING - 1)), item]);
    timers.current.push(window.setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 2500));
  }, []);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  return { items, fire };
}

/** Overlay: place inside the `relative` stage wrapper. */
export function ReactionLayer({ items }: { items: FloatingReaction[] }) {
  return (
    <div aria-hidden className="reaction-layer">
      {items.map((i) => {
        const def = KINDS.find((k) => k.kind === i.kind) ?? KINDS[0];
        return (
          <span
            key={i.id}
            className="reaction-float"
            style={{
              ['--rx' as string]: `${i.x}%`,
              ['--rdx' as string]: `${i.dx}px`,
              ['--rdy' as string]: `${i.dy}px`,
              ['--rrot' as string]: `${i.rot}deg`,
            }}
          >
            <def.Icon
              size={28}
              fill={def.color}
              color={def.color}
              strokeWidth={1.5}
              style={{ filter: `drop-shadow(0 0 8px ${def.color})` }}
            />
          </span>
        );
      })}
    </div>
  );
}

export function ReactionBar({ onReact }: { onReact: (kind: ReactionKind) => void }) {
  return (
    <div role="group" aria-label="Reactions" className="glass mx-auto flex w-fit items-center gap-1 rounded-full px-2 py-1">
      {KINDS.map(({ kind, label, color, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onReact(kind)}
          title={label}
          aria-label={label}
          className="react-btn flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon size={18} color={color} fill={kind === 'heart' || kind === 'fire' ? color : 'none'} />
        </button>
      ))}
    </div>
  );
}
