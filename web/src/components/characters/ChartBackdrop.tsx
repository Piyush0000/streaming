import { useMemo } from 'react';

/** Deterministic pseudo-random so the backdrop is stable across renders. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Faint animated candlestick field for page backgrounds. Purely decorative,
 * pointer-events none; candles breathe via transform (scaleY) only.
 */
export default function ChartBackdrop({ className = '' }: { className?: string }) {
  const candles = useMemo(() => {
    const r = rng(7);
    const out: Array<{ x: number; top: number; h: number; wick: number; up: boolean; delay: number }> = [];
    let level = 190;
    for (let i = 0; i < 40; i++) {
      const up = r() > 0.42;
      const h = 14 + r() * 38;
      level = Math.min(250, Math.max(70, level + (up ? -1 : 1) * (6 + r() * 16)));
      out.push({ x: 20 + i * 34, top: level, h, wick: 8 + r() * 16, up, delay: -r() * 8 });
    }
    return out;
  }, []);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1400 320"
      preserveAspectRatio="xMidYMax slice"
      className={`ch-art ch-animated pointer-events-none absolute inset-x-0 bottom-0 h-[46%] w-full opacity-[0.16] ${className}`}
      style={{ maskImage: 'linear-gradient(to top, #000 15%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to top, #000 15%, transparent 95%)' }}
    >
      {candles.map((c) => (
        <g key={c.x} className="ch-candle" style={{ animationDelay: `${c.delay}s`, animationDuration: '7s' }}>
          <path d={`M${c.x} ${c.top - c.wick}V${c.top + c.h + c.wick}`} stroke={c.up ? '#34d399' : '#fb7185'} strokeWidth="2" strokeLinecap="round" />
          <rect x={c.x - 7} y={c.top} width="14" height={c.h} rx="3" fill={c.up ? '#34d399' : '#fb7185'} />
        </g>
      ))}
    </svg>
  );
}
