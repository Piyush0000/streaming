import { memo } from 'react';

export type BackgroundVariant = 'aurora' | 'grid-pulse' | 'particles';

const PARTICLE_COUNT = 28; // hard cap is 40

/** Deterministic pseudo-random in [0,1) so particles are stable across renders (no Math.random in render). */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const PARTICLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
  x: `${Math.round(rnd(i, 1) * 100)}%`,
  s: `${(2 + rnd(i, 2) * 3).toFixed(1)}px`,
  d: `${(12 + rnd(i, 3) * 14).toFixed(1)}s`,
  delay: `${(-rnd(i, 4) * 20).toFixed(1)}s`,
  dx: `${Math.round((rnd(i, 5) - 0.5) * 80)}px`,
}));

/**
 * Decorative animated layer. Put it as the first child of a `relative` parent and lift real
 * content with `relative z-10`. Pure CSS (transform/opacity only), no canvas, <= 40 elements.
 */
function AnimatedBackground({
  variant = 'aurora',
  subtle = false,
  className = '',
}: {
  variant?: BackgroundVariant;
  /** Dimmer version for dense, text-heavy pages. */
  subtle?: boolean;
  className?: string;
}) {
  return (
    <div aria-hidden className={`bg-anim ${className}`} data-subtle={subtle ? 'true' : undefined}>
      {variant === 'aurora' && (
        <>
          <span className="bg-blob bg-blob-a" />
          <span className="bg-blob bg-blob-b" />
          <span className="bg-blob bg-blob-c" />
        </>
      )}
      {variant === 'grid-pulse' && (
        <>
          <span className="bg-grid-pulse" />
          <span className="bg-grid" />
        </>
      )}
      {variant === 'particles' && (
        <>
          <span className="bg-blob bg-blob-a" />
          <span className="bg-blob bg-blob-b" />
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="bg-particle"
              style={{
                ['--x' as string]: p.x,
                ['--s' as string]: p.s,
                ['--d' as string]: p.d,
                ['--delay' as string]: p.delay,
                ['--dx' as string]: p.dx,
              }}
            />
          ))}
        </>
      )}
      <span className="bg-vignette" />
    </div>
  );
}

export default memo(AnimatedBackground);
