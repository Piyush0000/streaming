import { Frame, Grad, type ArtProps } from './parts';

// Generic coin / chart glyphs. Deliberately NOT any real token's logo.

function Coin({
  p,
  name,
  from,
  to,
  rim,
  children,
}: {
  p: ArtProps;
  name: string;
  from: string;
  to: string;
  rim: string;
  children: React.ReactNode;
}) {
  return (
    <Frame {...p} title={p.title ?? name}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}c`} from={from} to={to} />
          </defs>
          <g className="ch-float">
            <circle cx="60" cy="60" r="48" fill={`url(#${u}c)`} />
            <circle cx="60" cy="60" r="48" fill="none" stroke={rim} strokeWidth="5" />
            <circle cx="60" cy="60" r="37" fill="none" stroke={rim} strokeWidth="2" strokeDasharray="3 5" opacity=".7" />
            {children}
            <path d="M28 34c6-9 16-15 28-16" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".55" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function CoinGold(p: ArtProps) {
  return (
    <Coin p={p} name="Gold coin" from="#fde68a" to="#f59e0b" rim="#b45309">
      <path d="M40 76V56M52 76V44M64 76V52M76 76V38" stroke="#92400e" strokeWidth="7" strokeLinecap="round" />
    </Coin>
  );
}

export function CoinSilver(p: ArtProps) {
  return (
    <Coin p={p} name="Silver coin" from="#f1f5f9" to="#94a3b8" rim="#64748b">
      <path d="M36 70l14-14 10 8 22-24" stroke="#334155" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M72 40h10v10" stroke="#334155" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Coin>
  );
}

export function CoinViolet(p: ArtProps) {
  return (
    <Coin p={p} name="Violet coin" from="#c4b5fd" to="#6d28d9" rim="#4c1d95">
      <path d="M60 36l18 10v20L60 76 42 66V46z" fill="none" stroke="#f5f3ff" strokeWidth="6" strokeLinejoin="round" />
      <circle cx="60" cy="56" r="5" fill="#f5f3ff" />
    </Coin>
  );
}

export function CoinTeal(p: ArtProps) {
  return (
    <Coin p={p} name="Teal coin" from="#99f6e4" to="#0d9488" rim="#115e59">
      <path d="M66 34L46 62h12l-4 22 20-30H62z" fill="#f0fdfa" />
    </Coin>
  );
}

export const COINS = [
  { id: 'gold', Component: CoinGold },
  { id: 'silver', Component: CoinSilver },
  { id: 'violet', Component: CoinViolet },
  { id: 'teal', Component: CoinTeal },
] as const;
