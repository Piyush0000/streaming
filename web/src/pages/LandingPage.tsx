import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MonitorUp, MessageSquare, Brain, Radio, ArrowRight, Zap } from 'lucide-react';
import Avatar from '../components/Avatar';
import HubTeaser from '../components/hub/HubTeaser';
import Reveal from '../components/Reveal';
import { Astronaut, Bear, Bull, Gem, Robot, Rocket, Whale, Wizard } from '../components/characters/Mascots';
import { CoinGold, CoinSilver, CoinTeal, CoinViolet } from '../components/characters/Coins';
import { CHARACTER_LIST, type PresetId } from '../components/characters/characters';
import ChartBackdrop from '../components/characters/ChartBackdrop';
import { CandleScene, ShieldScene, StreamScene, VoiceScene } from '../components/characters/Scenes';
import { useInView } from '../hooks/useReveal';
import AnimatedBackground from '../components/AnimatedBackground';
import { useCountUp } from '../hooks/useCountUp';

const FEATURES = [
  {
    icon: Mic,
    iconClass: 'text-accent',
    title: 'Voice & Live Rooms',
    sub: 'Drop into voice channels, or join live rooms where the host picks who speaks for Q&A.',
  },
  {
    icon: MonitorUp,
    iconClass: 'text-emerald-400',
    title: 'Screen Sharing',
    sub: 'Share your charts and setups in real time.',
  },
  {
    icon: MessageSquare,
    iconClass: 'text-sky-400',
    title: 'Real-time Chat',
    sub: 'Fast, focused channels for every market and idea.',
  },
  {
    icon: Brain,
    iconClass: 'text-violet-400',
    title: 'AI Trading Community',
    sub: 'Built alongside Elonix — the AI-powered trading suite.',
  },
];

const STATS = [
  { value: 150, prefix: '', suffix: '', label: 'Listeners per live room' },
  { value: 25, prefix: '', suffix: '', label: 'People per voice room' },
  { value: 2, prefix: '', suffix: '', label: 'Warnings before a ban' },
];

function Stat({ value, prefix, suffix, label }: (typeof STATS)[number]) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const n = useCountUp(value, seen);
  return (
    <div ref={ref} className="text-center">
      <p className="text-3xl font-extrabold tabular-nums text-text-primary sm:text-4xl">
        {prefix}
        {n.toLocaleString()}
        <span className="text-accent">{suffix}</span>
      </p>
      <p className="mt-1 text-xs uppercase tracking-wide text-text-muted sm:text-sm">{label}</p>
    </div>
  );
}

/** Staggered hero entrance: inline style keeps the delay out of the class list. */
const stagger = (i: number) => ({ animationDelay: `${i * 90}ms` });

const ROW_CHARACTERS: PresetId[] = ['bull', 'robot', 'fox', 'whale', 'rocket', 'cat'];

/** Floating hero characters (lg+): `depth` is the max pointer-parallax offset in px. */
const HERO_CLUSTER: Array<{ node: ReactNode; className: string; depth: number; delay: string }> = [
  { node: <Bull size={132} animated />, className: 'left-0 top-4 xl:-left-6', depth: 22, delay: '0s' },
  { node: <Robot size={104} animated />, className: 'left-10 top-[58%] xl:left-2', depth: 34, delay: '-1.4s' },
  { node: <CoinGold size={52} animated />, className: 'left-[19%] top-0', depth: 46, delay: '-0.6s' },
  { node: <Rocket size={128} animated />, className: 'right-0 top-2 xl:-right-6', depth: 24, delay: '-2s' },
  { node: <Astronaut size={100} animated />, className: 'right-8 top-[56%] xl:right-0', depth: 36, delay: '-0.9s' },
  { node: <CoinViolet size={48} animated />, className: 'right-[18%] top-2', depth: 44, delay: '-2.6s' },
  { node: <CoinTeal size={40} animated />, className: 'left-[24%] top-[88%]', depth: 40, delay: '-1.9s' },
  { node: <CoinSilver size={44} animated />, className: 'right-[24%] top-[90%]', depth: 38, delay: '-0.3s' },
];

const SHOWCASE = [
  {
    scene: <CandleScene />,
    title: 'Talk setups as the market moves',
    body: 'Break down charts with other traders in text and voice while the candles print. Share your screen so everyone sees the same level you are looking at.',
    accent: 'text-emerald-400',
  },
  {
    scene: <VoiceScene />,
    title: 'Voice channels and live rooms',
    body: 'Drop into a voice room with up to 25 people, or tune in to a live room with up to 150 listeners where the host picks who gets to speak for Q&A.',
    accent: 'text-accent',
  },
  {
    scene: <StreamScene />,
    title: 'Go live, screen and all',
    body: 'Hosts can stream their screen while listeners follow along and chat on the side. Ask to speak and the host can bring you up.',
    accent: 'text-sky-400',
  },
  {
    scene: <ShieldScene />,
    title: 'Community rules that are enforced',
    body: 'Hosts and moderators can warn and remove people. Two warnings and you are out, so rooms stay focused on the trading.',
    accent: 'text-violet-400',
  },
];

/** Pointer-driven parallax: writes --mx/--my in [-1, 1] on the element; CSS does the rest. */
function useParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        el.style.setProperty('--mx', String(clamp(((e.clientX - r.left) / r.width - 0.5) * 2)));
        el.style.setProperty('--my', String(clamp(((e.clientY - r.top) / r.height - 0.5) * 2)));
      });
    };
    const onLeave = () => {
      el.style.setProperty('--mx', '0');
      el.style.setProperty('--my', '0');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

/** Scroll-driven parallax: writes --py (px scrolled, clamped) on the element, rAF-throttled. CSS applies it with a per-layer --speed. */
function useScrollParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--py', String(Math.min(1400, Math.max(0, window.scrollY || 0))));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

const TICKER_COINS = [CoinGold, CoinViolet, CoinTeal, CoinSilver, CoinGold, CoinViolet, CoinTeal, CoinSilver];

/** Endless strip of generic coin glyphs (decorative; the list is duplicated so the -50% loop is seamless). */
function CoinTicker() {
  return (
    <div aria-hidden className="relative mx-auto max-w-6xl overflow-hidden py-6 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="marquee">
        {[0, 1].map((half) => (
          <div key={half} className="flex shrink-0 items-center gap-10 pr-10">
            {TICKER_COINS.map((Coin, i) => (
              <span key={i} className="opacity-80">
                <Coin size={34} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useParallax<HTMLDivElement>();
  const scrollRef = useScrollParallax<HTMLDivElement>();

  return (
    <div ref={scrollRef} className="relative min-h-[100dvh] w-full animate-fade-in overflow-hidden bg-base text-text-primary">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <AnimatedBackground variant="particles" />
      </div>
      {/* Animated background orbs (scroll parallax: drift up slower than the page) */}
      <div className="parallax fixed inset-0 z-0 pointer-events-none" style={{ ['--speed' as string]: -0.12 }}>
        <div className="absolute -left-20 -top-20 w-96 h-96 rounded-full bg-gradient-to-br from-accent/20 via-accent/5 to-transparent blur-3xl animate-orb-drift opacity-60" />
        <div
          className="absolute right-0 top-10 w-80 h-80 rounded-full bg-gradient-to-br from-sky-400/10 via-accent/5 to-transparent blur-3xl animate-orb-drift opacity-50"
          style={{ animationDelay: '-6s', animationDuration: '22s' }}
        />
        <div
          className="absolute left-1/2 top-1/3 w-72 h-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-violet-400/10 via-accent/5 to-transparent blur-3xl animate-orb-drift opacity-40"
          style={{ animationDelay: '-12s', animationDuration: '26s' }}
        />
      </div>

      {/* Animated candlestick backdrop */}
      <ChartBackdrop />

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <span className="text-lg font-black tracking-tight">
            ELON<span className="text-accent">IX</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/elonixhub')}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
            >
              Hub
            </button>
            <button
              onClick={() => navigate('/login')}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              Sign in
            </button>
          </div>
        </header>

        <main className="flex-1 px-5 sm:px-8">
          {/* Hero */}
          <div ref={heroRef} className="relative mx-auto max-w-6xl">
            {/* Floating character cluster (large screens) */}
            <div aria-hidden className="parallax pointer-events-none absolute inset-0 hidden lg:block" style={{ ['--speed' as string]: 0.22 }}>
              {HERO_CLUSTER.map((c, i) => (
                <div key={i} className={`absolute ${c.className}`}>
                  <div className="ch-drift" style={{ ['--depth' as string]: c.depth }}>
                    <div className="animate-float" style={{ animationDelay: c.delay }}>
                      {c.node}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <section className="relative mx-auto max-w-3xl pt-10 pb-16 text-center sm:pt-16 sm:pb-20">
              <div className="mb-6 inline-flex animate-rise-in items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2" style={stagger(0)}>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold tracking-wide text-accent sm:text-sm">
                  LIVE VOICE &amp; TRADING COMMUNITY
                </span>
              </div>

              <h1 className="mb-5 animate-rise-in text-4xl font-extrabold leading-tight sm:text-5xl md:text-6xl" style={stagger(1)}>
                Where Traders
                <br />
                <span className="text-gradient-anim">
                  Talk Live
                </span>
              </h1>

              <p className="mx-auto mb-10 max-w-2xl animate-rise-in text-base leading-relaxed text-text-secondary sm:text-lg" style={stagger(2)}>
                Voice channels, live chat, and screen-shared charts — Elonix is the real-time
                community layer for the <span className="font-semibold text-accent">AI-powered trading</span> crowd.
                Drop into a room, share your screen, and talk setups as the market moves.
              </p>

              <div className="flex animate-rise-in flex-col items-center justify-center gap-3 sm:flex-row" style={stagger(3)}>
                <button
                  onClick={() => navigate('/login')}
                  className="cta-border group inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-transform duration-300 hover:scale-105 sm:text-base"
                >
                  <span>Join Elonix</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>

              {/* Character row */}
              <div className="mt-12 flex animate-rise-in flex-col items-center gap-3" style={stagger(4)}>
                <div className="flex items-center -space-x-2">
                  {ROW_CHARACTERS.map((id, i) => (
                    <span key={id} className="inline-flex animate-float" style={{ animationDelay: `${i * -0.7}s` }}>
                      <Avatar name={id} preset={id} size={44} className="ring-2 ring-base" />
                    </span>
                  ))}
                </div>
                <p className="flex items-center gap-2 text-xs text-text-muted sm:text-sm">
                  <Radio className="h-3.5 w-3.5 animate-pulse text-success" />
                  Live voice rooms, screen sharing and chat for traders
                </p>
              </div>
            </section>
          </div>

          <CoinTicker />

          {/* Stats */}
          <section className="mx-auto max-w-3xl pb-16">
            <Reveal className="glass grid grid-cols-3 gap-4 rounded-2xl px-4 py-6">
              {STATS.map((s) => (
                <Stat key={s.label} {...s} />
              ))}
            </Reveal>
          </section>

          {/* Feature cards */}
          <section className="mx-auto max-w-5xl pb-20">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, iconClass, title, sub }, i) => (
                <Reveal key={title} delay={i * 90} className="h-full">
                <div
                  className="group hover-tilt glass glass-glow h-full rounded-2xl p-5"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
                    <Icon className={`h-5 w-5 ${iconClass}`} />
                  </div>
                  <h3 className="mb-1 text-sm font-bold text-text-primary sm:text-base">{title}</h3>
                  <p className="text-xs text-text-secondary sm:text-sm">{sub}</p>
                </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Illustrated feature showcase */}
          <section className="mx-auto max-w-5xl space-y-14 pb-20 sm:space-y-20">
            {SHOWCASE.map((f, i) => (
              <Reveal key={f.title}>
                <div className={`grid items-center gap-6 md:grid-cols-2 md:gap-10 ${i % 2 ? 'md:[&>*:first-child]:order-2' : ''}`}>
                  <div className="overflow-hidden rounded-2xl border border-border shadow-lg">{f.scene}</div>
                  <div>
                    <h3 className={`mb-2 text-xl font-extrabold sm:text-2xl ${f.accent}`}>{f.title}</h3>
                    <p className="text-sm leading-relaxed text-text-secondary sm:text-base">{f.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </section>

          {/* Meet the community */}
          <section className="mx-auto max-w-5xl pb-20">
            <Reveal className="mb-8 text-center">
              <h2 className="text-2xl font-extrabold sm:text-3xl">Meet the community</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-text-secondary sm:text-base">
                Pick a character as your profile avatar, or upload your own photo. Here are the ones waiting for you.
              </p>
            </Reveal>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {CHARACTER_LIST.map((c, i) => (
                <li key={c.id}>
                  <Reveal delay={i * 50} className="h-full">
                    <div className="group hover-tilt glass glass-glow flex h-full flex-col items-center rounded-2xl p-4 text-center">
                      <div className="mb-3 transition-transform duration-300 group-hover:scale-110">
                        <Avatar name={c.label} preset={c.id} size={80} />
                      </div>
                      <p className="text-sm font-bold text-text-primary">{c.label}</p>
                      <p className="mt-1 text-xs text-text-muted">{c.tagline}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </section>

          <Reveal>
            <HubTeaser />
          </Reveal>

          {/* Secondary CTA strip */}
          <section className="mx-auto max-w-5xl pb-20">
            <Reveal className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-panel via-base to-panel p-8 text-center sm:p-12">
              <div className="absolute -top-10 -left-10 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
              <div className="absolute -bottom-10 -right-10 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />
              <div className="relative z-10">
                <div aria-hidden className="mx-auto mb-4 flex items-end justify-center gap-1 sm:gap-3">
                  <Wizard size={64} animated className="hidden sm:block" />
                  <Bear size={72} animated />
                  <Bull size={92} animated />
                  <Whale size={72} animated />
                  <Gem size={64} animated className="hidden sm:block" />
                </div>
                <h2 className="mb-3 text-2xl font-extrabold sm:text-3xl">Ready to talk markets live?</h2>
                <p className="mx-auto mb-7 max-w-xl text-sm text-text-secondary sm:text-base">
                  Sign in with Google and jump straight into voice and text channels built for
                  traders.
                </p>
                <button
                  onClick={() => navigate('/login')}
                  className="cta-border inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-transform duration-300 hover:scale-105 sm:text-base"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="border-t border-border px-5 py-6 text-center text-xs text-text-muted sm:px-8">
          © {new Date().getFullYear()} Elonix. Part of the Elonix trading suite.
        </footer>
      </div>
    </div>
  );
}
