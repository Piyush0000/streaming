import { ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/format';

/**
 * Wraps a changing number: a quick slide-up tick plus a green/red wash when the value goes up/down.
 * Only opacity/transform are animated (the wash is a pseudo-element's opacity); the global
 * reduced-motion rule collapses all durations.
 */
export default function Flash({
  value,
  children,
  className,
}: {
  value: number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const prev = useRef<number | null | undefined>(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);

  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (typeof value !== 'number' || typeof p !== 'number' || !Number.isFinite(value) || value === p) return;
    setFlash((f) => ({ dir: value > p ? 'up' : 'down', n: (f?.n ?? 0) + 1 }));
  }, [value]);

  return (
    <span
      key={flash?.n ?? 0}
      className={cx('trade-flash inline-block tabular-nums', flash && `trade-flash-${flash.dir} animate-tick`, className)}
    >
      {children}
    </span>
  );
}

/** Keyframes for <Flash/>; rendered once by the trade page. */
export function FlashStyles() {
  return (
    <style>{`
      .trade-flash { position: relative; isolation: isolate; border-radius: 4px; }
      .trade-flash::after { content: ''; position: absolute; inset: -1px -3px; border-radius: 4px; opacity: 0; pointer-events: none; z-index: -1; }
      .trade-flash-up::after { background: rgba(34,197,94,.35); animation: trade-wash 700ms ease-out; }
      .trade-flash-down::after { background: rgba(239,68,68,.35); animation: trade-wash 700ms ease-out; }
      @keyframes trade-wash { 0% { opacity: 1; } 100% { opacity: 0; } }
    `}</style>
  );
}
