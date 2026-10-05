import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/format';

export interface ArtProps {
  /** Rendered size in px (the art is square, viewBox 0 0 120 120). */
  size?: number | string;
  /** Enables idle animations (float / blink / tail-wag). Honors reduced-motion via CSS. */
  animated?: boolean;
  className?: string;
  /** Accessible name. Pass '' to mark the art decorative (aria-hidden). */
  title?: string;
  /** Position when nested inside another <svg> (scenes). */
  x?: number;
  y?: number;
}

/** Shared SVG shell: same viewBox, accessible title, unique gradient-id prefix per instance. */
export function Frame({
  title,
  size = 96,
  animated = false,
  className,
  x,
  y,
  viewBox = '0 0 120 120',
  children,
}: Omit<ArtProps, 'title'> & {
  title: string; viewBox?: string; children: (uid: string) => ReactNode }) {
  const uid = 'c' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const decorative = title === '';
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      x={x}
      y={y}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      className={cx('ch-art', animated && 'ch-animated', className)}
      focusable="false"
    >
      {!decorative && title ? <title>{title}</title> : null}
      {children(uid)}
    </svg>
  );
}

export function Grad({
  id,
  from,
  to,
  vertical = true,
}: {
  id: string;
  from: string;
  to: string;
  vertical?: boolean;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? 0 : 1} y2={1}>
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

/** A pair of eyes that blink together (scaleY on the group). */
export function Eyes({
  cx1,
  cx2,
  cy,
  r = 6,
  iris = '#1b1b2f',
  white = '#fff',
}: {
  cx1: number;
  cx2: number;
  cy: number;
  r?: number;
  iris?: string;
  white?: string;
}) {
  return (
    <g className="ch-blink">
      {[cx1, cx2].map((x) => (
        <g key={x}>
          <circle cx={x} cy={cy} r={r} fill={white} />
          <circle cx={x + 0.8} cy={cy + 0.6} r={r * 0.58} fill={iris} />
          <circle cx={x + 2} cy={cy - 1.4} r={r * 0.2} fill="#fff" />
        </g>
      ))}
    </g>
  );
}

export const Mirror = ({ children }: { children: ReactNode }) => (
  <g transform="translate(120 0) scale(-1 1)">{children}</g>
);
