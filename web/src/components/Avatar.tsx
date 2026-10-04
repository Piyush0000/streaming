import { useEffect, useState } from 'react';
import { colorForName, cx, initials } from '../lib/format';

export type AvatarSize = 'sm' | 'md' | 'lg' | number;

const SIZE_PX = { sm: 24, md: 36, lg: 72 } as const;

/** Two-stop gradient derived deterministically from the username. */
function gradientForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 62%, 52%), hsl(${(hue + 42) % 360}, 58%, 38%))`;
}

/**
 * Initial-based avatar. `speaking` shows a pulsing ring (voice activity),
 * `glow` a soft breathing halo (host/speaker), `online` a presence dot,
 * `ring` the legacy static "present" ring. `size` is sm/md/lg or pixels.
 */
export default function Avatar({
  name,
  size = 'md',
  ring = false,
  speaking = false,
  glow = false,
  online,
  className,
  src,
}: {
  /** Optional profile picture; falls back to the gradient initial if absent or it fails to load. */
  src?: string | null;
  name: string;
  size?: AvatarSize;
  ring?: boolean;
  speaking?: boolean;
  glow?: boolean;
  online?: boolean;
  className?: string;
}) {
  const safeName = name || '?';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => setFailedSrc(null), [src]);
  const showImage = !!src && failedSrc !== src;
  const px = typeof size === 'number' ? size : SIZE_PX[size] ?? 36;
  const dot = Math.max(8, Math.round(px * 0.28));
  let background: string;
  try {
    background = gradientForName(safeName);
  } catch {
    background = colorForName(safeName);
  }

  return (
    <div
      className={cx(
        'relative inline-flex shrink-0 rounded-full',
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
      {speaking && (
        <>
          <span
            aria-hidden
            className="speaking-ring pointer-events-none absolute inset-0 animate-speaking-ring rounded-full border-2 border-success"
          />
          <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-full border-2 border-success" />
        </>
      )}
      <span
        className="relative flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
        style={{ fontSize: Math.max(10, px * 0.38), background }}
      >
        {showImage ? (
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
        <span
          aria-hidden
          className={cx(
            'absolute bottom-0 right-0 rounded-full ring-2 ring-panel',
            online ? 'bg-success' : 'bg-text-muted'
          )}
          style={{ width: dot, height: dot }}
        />
      )}
    </div>
  );
}
