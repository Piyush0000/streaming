import { useEffect, useState } from 'react';

/**
 * Whole seconds remaining until `until` (epoch ms), ticking while active.
 * Returns 0 once elapsed (or when `until` is null/undefined).
 */
export function useCountdown(until: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [until]);

  if (!until) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
