import { useEffect, useState } from 'react';

const COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e'];
const COUNT = 20;

const PIECES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * Math.PI * 2 + (i % 3) * 0.15;
  const dist = 90 + ((i * 37) % 70);
  return {
    c: COLORS[i % COLORS.length],
    cx: `${Math.round(Math.cos(angle) * dist)}px`,
    cy: `${Math.round(Math.sin(angle) * dist * 0.8 + 70)}px`,
    cr: `${(i % 2 ? 1 : -1) * (240 + ((i * 53) % 300))}deg`,
    cd: `${((i % 5) * 0.03).toFixed(2)}s`,
  };
});

/**
 * One-shot confetti burst (~20 CSS elements). Re-fires whenever `trigger` changes to a new
 * truthy number and removes its elements from the DOM after the animation. Put inside a
 * `relative` container.
 */
export default function Confetti({ trigger }: { trigger: number }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!trigger) return;
    setActive(trigger);
    const t = window.setTimeout(() => setActive(0), 1700);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (!active) return null;
  return (
    <div key={active} aria-hidden className="confetti">
      {PIECES.map((p, i) => (
        <i
          key={i}
          style={{
            ['--c' as string]: p.c,
            ['--cx' as string]: p.cx,
            ['--cy' as string]: p.cy,
            ['--cr' as string]: p.cr,
            ['--cd' as string]: p.cd,
          }}
        />
      ))}
    </div>
  );
}
