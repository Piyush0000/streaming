import { Eyes, Frame, Grad, Mirror, type ArtProps } from './parts';

// Original trader-themed mascots. Flat shapes + soft gradients, 120x120 viewBox.

export function Bull(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Bull'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#f59e5b" to="#c2571f" />
            <Grad id={`${u}s`} from="#ffc4b8" to="#f08f86" />
          </defs>
          <g className="ch-float">
            <Mirror>
              <path d="M34 40C14 38 8 20 18 10c1 14 9 20 22 22z" fill="#fff4dc" />
            </Mirror>
            <path d="M34 40C14 38 8 20 18 10c1 14 9 20 22 22z" fill="#fff4dc" />
            <ellipse cx="22" cy="54" rx="11" ry="7" transform="rotate(-20 22 54)" fill="#c2571f" />
            <ellipse cx="98" cy="54" rx="11" ry="7" transform="rotate(20 98 54)" fill="#c2571f" />
            <path d="M60 18c20 0 34 14 34 38 0 22-12 40-34 40S26 78 26 56c0-24 14-38 34-38z" fill={`url(#${u}h)`} />
            <path d="M48 24c4-3 20-3 24 0-4 6-20 6-24 0z" fill="#7a2f0e" opacity=".35" />
            <ellipse cx="60" cy="78" rx="22" ry="16" fill={`url(#${u}s)`} />
            <ellipse cx="51" cy="78" rx="3" ry="4" fill="#9b3a2a" />
            <ellipse cx="69" cy="78" rx="3" ry="4" fill="#9b3a2a" />
            <path d="M50 90c4 8 16 8 20 0" fill="none" stroke="#f4c542" strokeWidth="3.5" strokeLinecap="round" />
            <Eyes cx1={46} cx2={74} cy={54} />
            <path d="M38 44l14 4M82 44l-14 4" stroke="#7a2f0e" strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Bear(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Bear'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#a8744f" to="#6e4527" />
          </defs>
          <g className="ch-float">
            <circle cx="28" cy="32" r="14" fill="#6e4527" />
            <circle cx="92" cy="32" r="14" fill="#6e4527" />
            <circle cx="28" cy="32" r="7" fill="#d9a77c" />
            <circle cx="92" cy="32" r="7" fill="#d9a77c" />
            <ellipse cx="60" cy="60" rx="38" ry="36" fill={`url(#${u}h)`} />
            <ellipse cx="60" cy="74" rx="19" ry="15" fill="#f1d6b5" />
            <ellipse cx="60" cy="68" rx="7" ry="5" fill="#2b1a10" />
            <path d="M60 73v6M52 82c4 4 12 4 16 0" fill="none" stroke="#2b1a10" strokeWidth="3" strokeLinecap="round" />
            <Eyes cx1={44} cx2={76} cy={52} r={5} />
            <path d="M34 98c10 10 42 10 52 0l6 14H28z" fill="#ef4444" />
            <path d="M52 108l-4 10h10zM72 106l4 12H64z" fill="#b91c1c" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Robot(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Robot trader'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#c7d2fe" to="#6b7bd6" />
            <Grad id={`${u}v`} from="#1e2447" to="#0b0f26" />
          </defs>
          <g className="ch-float">
            <path d="M60 24V12" stroke="#8b97e6" strokeWidth="4" strokeLinecap="round" />
            <circle cx="60" cy="10" r="6" fill="#34d399" className="ch-twinkle" />
            <rect x="12" y="52" width="10" height="24" rx="5" fill="#6b7bd6" />
            <rect x="98" y="52" width="10" height="24" rx="5" fill="#6b7bd6" />
            <rect x="20" y="24" width="80" height="76" rx="24" fill={`url(#${u}h)`} />
            <rect x="29" y="40" width="62" height="32" rx="14" fill={`url(#${u}v)`} />
            <g className="ch-blink">
              <rect x="38" y="50" width="14" height="13" rx="5" fill="#22d3ee" />
              <rect x="68" y="50" width="14" height="13" rx="5" fill="#22d3ee" />
            </g>
            <path d="M42 57h6M72 57h6" stroke="#cffafe" strokeWidth="2" strokeLinecap="round" opacity=".7" />
            <rect x="40" y="82" width="40" height="10" rx="5" fill="#2b3475" />
            <path d="M47 85v4M54 85v4M61 85v4M68 85v4M75 85v4" stroke="#8b97e6" strokeWidth="2" strokeLinecap="round" />
            <path d="M24 34c10-6 22-8 34-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".5" fill="none" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Whale(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Whale'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}b`} from="#4aa8ff" to="#2457d6" />
          </defs>
          <g className="ch-float">
            <g className="ch-twinkle">
              <path
                d="M44 34c-6-8-14-8-16-2M44 34c2-10 10-14 16-8M44 34v-12"
                fill="none"
                stroke="#bfe6ff"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="28" cy="30" r="2.5" fill="#bfe6ff" />
              <circle cx="60" cy="24" r="2.5" fill="#bfe6ff" />
              <circle cx="44" cy="19" r="2.5" fill="#bfe6ff" />
            </g>
            <g className="ch-wag" style={{ transformOrigin: '96px 72px' }}>
              <path d="M92 72c6-4 12-14 8-26 6 4 12 2 16-4 2 16-6 32-20 38z" fill="#2f6ae6" />
            </g>
            <path d="M10 70c0-24 22-34 48-34 24 0 42 14 42 36 0 20-20 30-46 30-26 0-44-8-44-32z" fill={`url(#${u}b)`} />
            <path d="M14 76c10 14 30 18 52 16 14-1 26-6 32-14-4 18-22 26-44 26-24 0-40-8-40-28z" fill="#e8f5ff" />
            <path d="M44 88c-4 6-12 8-16 6 2-6 8-10 16-6z" fill="#2f6ae6" />
            <g className="ch-blink">
              <circle cx="34" cy="64" r="5" fill="#0f2a6b" />
              <circle cx="35.5" cy="62.5" r="1.7" fill="#fff" />
            </g>
            <path d="M20 76c6 5 14 6 20 3" fill="none" stroke="#0f2a6b" strokeWidth="2.5" strokeLinecap="round" />
            <ellipse cx="26" cy="72" rx="4" ry="2.5" fill="#ff9aa8" opacity=".7" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Astronaut(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Astronaut'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#ffffff" to="#c9d3ee" />
            <Grad id={`${u}v`} from="#2a3a7a" to="#0d1233" />
          </defs>
          <g className="ch-float">
            <path d="M82 20l8-10" stroke="#c9d3ee" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="91" cy="9" r="4.5" fill="#fb923c" className="ch-twinkle" />
            <circle cx="60" cy="58" r="42" fill={`url(#${u}h)`} />
            <rect x="12" y="48" width="12" height="20" rx="6" fill="#fb923c" />
            <rect x="96" y="48" width="12" height="20" rx="6" fill="#fb923c" />
            <ellipse cx="60" cy="58" rx="31" ry="26" fill={`url(#${u}v)`} />
            <path d="M40 44c6-8 18-11 28-8" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".45" />
            <g className="ch-blink">
              <circle cx="50" cy="60" r="4.5" fill="#fde68a" />
              <circle cx="70" cy="60" r="4.5" fill="#fde68a" />
            </g>
            <path d="M53 71c4 3 10 3 14 0" stroke="#fde68a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <circle cx="78" cy="42" r="1.6" fill="#fff" />
            <circle cx="42" cy="74" r="1.2" fill="#fff" />
            <rect x="40" y="98" width="40" height="14" rx="7" fill="#e7ecfa" />
            <circle cx="52" cy="105" r="3" fill="#34d399" />
            <circle cx="62" cy="105" r="3" fill="#f87171" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Rocket(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Rocket'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}b`} from="#ffffff" to="#cfd8f5" vertical={false} />
            <Grad id={`${u}f`} from="#fde047" to="#f97316" />
          </defs>
          <g className="ch-float">
            <g className="ch-flame" style={{ transformOrigin: '60px 88px' }}>
              <path d="M48 88c0 14 6 24 12 30 6-6 12-16 12-30z" fill={`url(#${u}f)`} />
              <path d="M54 88c0 8 3 14 6 17 3-3 6-9 6-17z" fill="#fff7c2" />
            </g>
            <path d="M44 74L26 92c-2-14 2-26 10-34zM76 74l18 18c2-14-2-26-10-34z" fill="#ef4444" />
            <path d="M60 6c18 12 26 34 24 66H36C34 40 42 18 60 6z" fill={`url(#${u}b)`} />
            <path d="M60 6c10 7 17 16 21 28H39C43 22 50 13 60 6z" fill="#ef4444" />
            <circle cx="60" cy="52" r="12" fill="#1e3a8a" />
            <circle cx="60" cy="52" r="8.5" fill="#60a5fa" />
            <path d="M55 48c2-3 6-4 9-2" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".8" />
            <rect x="36" y="72" width="48" height="8" rx="4" fill="#9fb0e8" />
            <circle cx="22" cy="30" r="2" fill="#fde68a" className="ch-twinkle" />
            <circle cx="100" cy="40" r="2.4" fill="#fff" className="ch-twinkle" style={{ animationDelay: '-1s' }} />
            <circle cx="96" cy="14" r="1.6" fill="#a5f3fc" className="ch-twinkle" style={{ animationDelay: '-2s' }} />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Gem(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Diamond hands gem'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}a`} from="#a5f3fc" to="#38bdf8" />
            <Grad id={`${u}b`} from="#38bdf8" to="#6366f1" />
            <Grad id={`${u}c`} from="#e0f2fe" to="#7dd3fc" />
          </defs>
          <g className="ch-float">
            <path d="M28 42l14-18h36l14 18z" fill={`url(#${u}c)`} />
            <path d="M28 42h64L60 100z" fill={`url(#${u}b)`} />
            <path d="M42 24l-4 18 22 58M78 24l4 18-22 58M28 42l32 58" stroke="#fff" strokeOpacity=".45" strokeWidth="2" fill="none" />
            <path d="M42 24l18 18 18-18" stroke="#fff" strokeOpacity=".5" strokeWidth="2" fill="none" />
            <path d="M42 24l-4 18h22z" fill={`url(#${u}a)`} opacity=".7" />
            <rect x="12" y="58" width="16" height="18" rx="8" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="2" />
            <rect x="92" y="58" width="16" height="18" rx="8" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="2" />
            <Eyes cx1={50} cx2={70} cy={58} r={5} iris="#1e1b4b" />
            <path d="M54 70c4 4 8 4 12 0" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M96 22l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#fff" className="ch-twinkle" />
            <path
              d="M20 26l1.5 4.5 4.5 1.5-4.5 1.5L20 38l-1.5-4.5L14 32l4.5-1.5z"
              fill="#fff"
              className="ch-twinkle"
              style={{ animationDelay: '-1.2s' }}
            />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Fox(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Fox'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#fb923c" to="#ea580c" />
          </defs>
          <g className="ch-float">
            <Mirror>
              <path d="M26 54L20 14l30 20z" fill="#ea580c" />
              <path d="M29 44l-3-20 15 11z" fill="#3b1d0f" />
            </Mirror>
            <path d="M26 54L20 14l30 20z" fill="#ea580c" />
            <path d="M29 44l-3-20 15 11z" fill="#3b1d0f" />
            <path d="M60 30c22 0 40 8 40 28 0 18-18 40-40 40S20 76 20 58c0-20 18-28 40-28z" fill={`url(#${u}h)`} />
            <path d="M20 62c14 2 28 14 40 36C48 98 24 84 20 62zM100 62C86 64 72 76 60 98c12 0 36-14 40-36z" fill="#fff7ed" />
            <ellipse cx="60" cy="86" rx="6" ry="4.5" fill="#2b1a10" />
            <path d="M60 90v4M54 96c3 2 9 2 12 0" stroke="#2b1a10" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <Eyes cx1={44} cx2={76} cy={62} r={5} iris="#3b1d0f" />
            <path d="M36 52l10 4M84 52l-10 4" stroke="#3b1d0f" strokeWidth="3" strokeLinecap="round" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Cat(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Cat'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#b9b4d6" to="#7b74ad" />
          </defs>
          <g className="ch-float">
            <g className="ch-wag" style={{ transformOrigin: '88px 104px' }}>
              <path d="M88 104c14 2 22-8 20-22" fill="none" stroke="#7b74ad" strokeWidth="7" strokeLinecap="round" />
            </g>
            <Mirror>
              <path d="M28 56L22 12l32 22z" fill="#7b74ad" />
              <path d="M31 44l-3-20 14 11z" fill="#f9a8d4" />
            </Mirror>
            <path d="M28 56L22 12l32 22z" fill="#7b74ad" />
            <path d="M31 44l-3-20 14 11z" fill="#f9a8d4" />
            <ellipse cx="60" cy="64" rx="40" ry="34" fill={`url(#${u}h)`} />
            <path d="M54 32l-2 12M60 30v14M66 32l2 12" stroke="#5a5388" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="60" cy="78" rx="14" ry="10" fill="#e9e6fb" />
            <path d="M56 72h8l-4 5z" fill="#f472b6" />
            <path d="M60 77v4M54 84c3 2 9 2 12 0" stroke="#5a5388" strokeWidth="2.2" strokeLinecap="round" fill="none" />
            <g className="ch-blink">
              <ellipse cx="44" cy="62" rx="6.5" ry="7.5" fill="#bbf7d0" />
              <ellipse cx="76" cy="62" rx="6.5" ry="7.5" fill="#bbf7d0" />
              <ellipse cx="44" cy="62" rx="2.4" ry="6" fill="#14231a" />
              <ellipse cx="76" cy="62" rx="2.4" ry="6" fill="#14231a" />
            </g>
            <path d="M8 74l20 4M8 84l20-2M112 74l-20 4M112 84l-20-2" stroke="#fff" strokeOpacity=".75" strokeWidth="2" strokeLinecap="round" />
          </g>
        </>
      )}
    </Frame>
  );
}

export function Wizard(p: ArtProps) {
  return (
    <Frame {...p} title={p.title ?? 'Wizard'}>
      {(u) => (
        <>
          <defs>
            <Grad id={`${u}h`} from="#8b5cf6" to="#4c1d95" />
          </defs>
          <g className="ch-float">
            <path d="M64 4c4 16 16 34 32 56H24c16-14 30-30 40-56z" fill={`url(#${u}h)`} />
            <ellipse cx="60" cy="60" rx="42" ry="9" fill="#5b21b6" />
            <ellipse cx="60" cy="57" rx="42" ry="8" fill="#7c3aed" />
            <path d="M52 40l1.8 5 5 1.8-5 1.8L52 54l-1.8-5.4-5-1.8 5-1.8z" fill="#fde047" className="ch-twinkle" />
            <circle cx="76" cy="34" r="6" fill="#fde047" />
            <circle cx="79" cy="32" r="5" fill="#6d28d9" />
            <circle cx="60" cy="80" r="21" fill="#fcd9b6" />
            <path d="M38 80c0 22 10 36 22 36s22-14 22-36c-4 8-12 12-22 12S42 88 38 80z" fill="#f4f1ff" />
            <path d="M52 94c4 3 12 3 16 0" stroke="#d9d3f2" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="60" cy="84" r="5" fill="#f59e8b" />
            <Eyes cx1={50} cx2={70} cy={74} r={4} />
            <path d="M44 66l10 3M76 66l-10 3" stroke="#e5e0f7" strokeWidth="4" strokeLinecap="round" />
          </g>
        </>
      )}
    </Frame>
  );
}
