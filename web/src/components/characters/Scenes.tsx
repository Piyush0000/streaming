import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { Bull, Fox, Robot, Whale } from './Mascots';
import { CoinGold } from './Coins';

// Themed feature illustrations. viewBox 240x150, decorative (aria-hidden); the
// surrounding card carries the text.

function Scene({ className, children }: { className?: string; children: (u: string) => ReactNode }) {
  const u = 's' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg
      viewBox="0 0 240 150"
      aria-hidden="true"
      focusable="false"
      className={cx('ch-art ch-animated block h-auto w-full', className)}
    >
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b2140" />
          <stop offset="1" stopColor="#0f1327" />
        </linearGradient>
        <linearGradient id={`${u}ac`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c8cff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="240" height="150" rx="16" fill={`url(#${u}bg)`} />
      {children(u)}
    </svg>
  );
}

const CANDLES: Array<[number, number, number, number, boolean]> = [
  // x, wick-top, wick-bottom, body-height, up?   (body bottom aligned at wick-bottom - 6)
  [34, 98, 128, 14, false],
  [58, 92, 124, 18, true],
  [82, 84, 118, 16, true],
  [106, 88, 116, 12, false],
  [130, 70, 108, 22, true],
  [154, 58, 96, 24, true],
  [178, 62, 90, 14, false],
  [202, 40, 82, 30, true],
];

/** Candlestick chart scene (with a bull cheering it on). */
export function CandleScene({ className }: { className?: string }) {
  return (
    <Scene className={className}>
      {() => (
        <>
          {[40, 70, 100, 130].map((y) => (
            <path key={y} d={`M16 ${y}H224`} stroke="#fff" strokeOpacity=".07" />
          ))}
          {CANDLES.map(([x, top, bottom, h, up], i) => (
            <g key={x} className="ch-candle" style={{ animationDelay: `${i * -0.5}s` }}>
              <path d={`M${x} ${top}V${bottom}`} stroke={up ? '#34d399' : '#fb7185'} strokeWidth="2" strokeLinecap="round" />
              <rect x={x - 6} y={bottom - 6 - h} width="12" height={h} rx="2.5" fill={up ? '#34d399' : '#fb7185'} />
            </g>
          ))}
          <path
            d="M30 118C60 108 80 104 104 100S150 82 176 66 206 44 218 34"
            stroke="#a5b4fc"
            strokeWidth="2.5"
            strokeDasharray="2 6"
            strokeLinecap="round"
            fill="none"
            opacity=".8"
          />
          <Bull x={4} y={4} size={46} animated />
          <CoinGold x={196} y={92} size={34} animated />
        </>
      )}
    </Scene>
  );
}

/** Voice / mic waves scene. */
export function VoiceScene({ className }: { className?: string }) {
  return (
    <Scene className={className}>
      {(u) => (
        <>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx="120"
              cy="72"
              r="26"
              fill="none"
              stroke="#7c8cff"
              strokeWidth="2"
              className="ch-wave"
              style={{ animationDelay: `${i * -0.9}s` }}
            />
          ))}
          <circle cx="120" cy="72" r="30" fill={`url(#${u}ac)`} />
          <rect x="112" y="52" width="16" height="28" rx="8" fill="#fff" />
          <path d="M106 74c0 10 6 16 14 16s14-6 14-16M120 90v10M112 100h16" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
          {[28, 40, 52, 188, 200, 212].map((x, i) => (
            <rect
              key={x}
              x={x}
              y={(i < 3 ? [60, 50, 64] : [64, 50, 60])[i % 3]}
              width="6"
              height={i % 3 === 1 ? 44 : 30}
              rx="3"
              fill="#34d399"
              opacity=".85"
              className="ch-eq"
              style={{ animationDelay: `${i * -0.35}s`, transformOrigin: `${x + 3}px 82px` }}
            />
          ))}
          <Fox x={10} y={104} size={40} animated />
          <Robot x={190} y={104} size={40} animated />
        </>
      )}
    </Scene>
  );
}

/** Live-stream / screen-share scene. */
export function StreamScene({ className }: { className?: string }) {
  return (
    <Scene className={className}>
      {(u) => (
        <>
          <rect x="22" y="18" width="150" height="100" rx="10" fill="#0b0f26" stroke="#3b4580" strokeWidth="2" />
          <rect x="30" y="26" width="134" height="84" rx="6" fill="#111737" />
          {[44, 62, 80, 98].map((y) => (
            <path key={y} d={`M34 ${y}H160`} stroke="#fff" strokeOpacity=".06" />
          ))}
          <path d="M36 98L56 84l18 8 24-30 20 14 22-26 20-12" stroke={`url(#${u}ac)`} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M36 98L56 84l18 8 24-30 20 14 22-26 20-12V110H36z" fill="#7c8cff" opacity=".12" />
          <rect x="38" y="32" width="38" height="16" rx="8" fill="#ef4444" />
          <circle cx="48" cy="40" r="3.5" fill="#fff" className="ch-twinkle" />
          <path d="M56 37h14M56 42h9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M80 126h54M107 118v8" stroke="#3b4580" strokeWidth="4" strokeLinecap="round" />
          {[
            [186, 26, 40],
            [186, 52, 30],
            [186, 78, 38],
          ].map(([x, y, w], i) => (
            <g key={y} className="ch-msg" style={{ animationDelay: `${i * -1.3}s` }}>
              <rect x={x} y={y} width={w + 20} height="18" rx="9" fill="#232b57" />
              <circle cx={x + 9} cy={y + 9} r="5" fill={['#34d399', '#f59e0b', '#a78bfa'][i]} />
              <path d={`M${x + 18} ${y + 9}h${w - 8}`} stroke="#8b97e6" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}
          <Whale x={176} y={102} size={46} animated />
        </>
      )}
    </Scene>
  );
}

/** Shield / moderation scene. */
export function ShieldScene({ className }: { className?: string }) {
  return (
    <Scene className={className}>
      {(u) => (
        <>
          <circle cx="120" cy="76" r="54" fill="#7c8cff" opacity=".08" className="ch-wave" />
          <g className="ch-float">
            <path d="M120 22l42 14v32c0 28-18 48-42 58-24-10-42-30-42-58V36z" fill={`url(#${u}ac)`} />
            <path d="M120 32l32 10v26c0 22-14 38-32 47-18-9-32-25-32-47V42z" fill="#0f1327" opacity=".35" />
            <path d="M104 74l12 12 22-26" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
          <path d="M26 40l1.8 5 5 1.8-5 1.8-1.8 5.4-1.8-5.4-5-1.8 5-1.8z" fill="#fde047" className="ch-twinkle" />
          <path d="M208 108l1.8 5 5 1.8-5 1.8-1.8 5.4-1.8-5.4-5-1.8 5-1.8z" fill="#a5f3fc" className="ch-twinkle" style={{ animationDelay: '-1.4s' }} />
          <Robot x={10} y={96} size={46} animated />
          <Bull x={184} y={20} size={44} animated />
        </>
      )}
    </Scene>
  );
}
