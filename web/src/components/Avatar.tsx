import { useEffect, useState } from 'react';
import { cx, initials } from '../lib/format';
import { avatarColor, avatarGradient } from '../lib/avatarColor';
import { getCharacter } from './characters/characters';

export type AvatarSize = 'sm' | 'md' | 'lg' | number;

const SIZE_PX = { sm: 24, md: 36, lg: 72 } as const;

/**
 * Initial-based avatar. `speaking` shows a pulsing ring (voice activity),
 * `gradientRing` a rotating gradient ring, `glow` a soft breathing halo (host/speaker), `online` a presence dot,
 * `ring` the legacy static "present" ring. `size` is sm/md/lg or pixels.
 */
export default function Avatar({
  name,
  size = 'md',
  ring = false,
  speaking = false,
  glow = false,
  gradientRing = false,
  online,
  className,
  src,
  preset,
}: {
  /** Optional profile picture; falls back to the gradient initial if absent or it fails to load. */
  src?: string | null;
  /** Preset character id (see characters/characters.ts). Takes precedence over `src`; unknown ids fall back to the initial. */
  preset?: string | null;
  name: string;
  size?: AvatarSize;
  ring?: boolean;
  speaking?: boolean;
  glow?: boolean;
  /** Slowly rotating multicolor ring (hosts / featured people). */
  gradientRing?: boolean;
  online?: boolean;
  className?: string;
}) {
  const safeName = name || '?';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => setFailedSrc(null), [src]);
  const character = getCharacter(preset);
  const showImage = !character && !!src && failedSrc !== src;
  const px = typeof size === 'number' ? size : SIZE_PX[size] ?? 36;
  const dot = Math.max(8, Math.round(px * 0.28));
  let background: string;
  try {
    background = avatarGradient(safeName);
  } catch {
    background = avatarColor(safeName);
  }

  return (
    <div
      className={cx(
        'avatar-pop relative inline-flex shrink-0 rounded-full',
        ring && 'ring-2 ring-success ring-offset-2 ring-offset-panel',
        className
      )}
      style={{ width: px, height: px }}
      title={safeName}
    >
      {glow && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 animate-glow-breathe rounded-full bg-accent/40 blur-md"
        />
      )}
      {gradientRing && !speaking && (
        <span aria-hidden className="avatar-conic">
          <span />
        </span>
      )}
      {speaking && (
        <>
          <span aria-hidden className="avatar-halo pointer-events-none" />
          <span aria-hidden className="avatar-halo avatar-halo-2 pointer-events-none" />
          <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-full border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.6)]" />
        </>
      )}
      <span
        className={cx(
          'relative flex h-full w-full items-center justify-center rounded-full font-semibold text-white',
          gradientRing && !speaking && 'ring-2 ring-panel'
        )}
        style={{ fontSize: Math.max(10, px * 0.38), background: character ? character.gradient : background }}
      >
        {character ? (
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
            <character.Component size={Math.round(px * 0.9)} title="" animated={px >= 64} />
          </span>
        ) : showImage ? (
          <img
            src={src!}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailedSrc(src!)}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials(safeName)
        )}
      </span>
      {online !== undefined && (
        <span aria-hidden className="absolute bottom-0 right-0" style={{ width: dot, height: dot }}>
          {online && <span className="status-pulse" />}
          <span
            className={cx('absolute inset-0 rounded-full ring-2 ring-panel', online ? 'bg-success' : 'bg-text-muted')}
          />
        </span>
      )}
    </div>
  );
}
