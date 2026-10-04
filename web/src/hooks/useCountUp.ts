import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';

/** Eases a number from 0 to `target` once `start` is true. Instant under reduced motion. */
export function useCountUp(target: number, start: boolean, durationMs = 1400): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, durationMs]);

  return value;
}
