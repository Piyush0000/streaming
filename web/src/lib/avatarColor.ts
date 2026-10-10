/**
 * Avatar backgrounds must keep white initials readable (>= 4.5:1). Yellow/green hues are
 * very luminous even at mid lightness, so lightness is lowered per hue until white text passes.
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio of white text on the given HSL colour (h in degrees, s/l in 0..1). */
export function whiteContrastOnHsl(h: number, s: number, l: number): number {
  return 1.05 / (luminance(hslToRgb(((h % 360) + 360) % 360, s, l)) + 0.05);
}

/** Highest lightness (<= start, in %) at which white text still reaches `min` contrast for this hue. */
export function readableLightness(hue: number, saturationPct: number, startPct: number, min = 4.6): number {
  let l = startPct;
  while (l > 14 && whiteContrastOnHsl(hue, saturationPct / 100, l / 100) < min) l -= 1;
  return l;
}

function hueForName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

/** Deterministic two-stop gradient for a name, always dark enough for white initials. */
export function avatarGradient(name: string): string {
  const hue = hueForName(name);
  const h2 = (hue + 42) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 62%, ${readableLightness(hue, 62, 50)}%), hsl(${h2}, 58%, ${readableLightness(h2, 58, 38)}%))`;
}

/** Flat variant of the same idea. */
export function avatarColor(name: string): string {
  const hue = hueForName(name);
  return `hsl(${hue}, 55%, ${readableLightness(hue, 55, 45)}%)`;
}
