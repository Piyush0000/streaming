import type { ReactNode } from 'react';
import { getCharacter, type PresetId } from './characters/characters';
import { cx } from '../lib/format';

/** Illustrated empty / not-found state using one of the mascots. */
export default function EmptyState({
  character,
  title,
  body,
  children,
  size = 112,
  className,
}: {
  character: PresetId;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  size?: number;
  className?: string;
}) {
  const def = getCharacter(character);
  const Art = def?.Component;
  return (
    <div className={cx('flex animate-rise-in flex-col items-center px-6 py-10 text-center', className)}>
      {Art && (
        <div className="relative mb-3">
          <span
            aria-hidden
            className="absolute inset-0 -z-0 rounded-full opacity-25 blur-2xl"
            style={{ background: def.gradient }}
          />
          <Art size={size} animated title="" className="relative" />
        </div>
      )}
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-text-muted">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
