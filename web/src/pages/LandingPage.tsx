import { useNavigate } from 'react-router-dom';
import {
  Mic,
  MonitorUp,
  MessageSquare,
  Brain,
  TrendingUp,
  Radio,
  ArrowRight,
  Zap,
} from 'lucide-react';
import Avatar from '../components/Avatar';
import HubTeaser from '../components/hub/HubTeaser';
import Reveal from '../components/Reveal';
import { useInView } from '../hooks/useReveal';
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

const ONLINE_NAMES = ['Ava Chen', 'Marcus Lee', 'Priya Raman', 'Diego Soto', 'Nina Park', 'Omar Ali'];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-[100dvh] w-full animate-fade-in overflow-hidden bg-base text-text-primary">
      {/* Animated background orbs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
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
          <section className="mx-auto max-w-4xl pt-10 pb-16 text-center sm:pt-16 sm:pb-20">
            <div className="mb-6 inline-flex animate-rise-in items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2" style={stagger(0)}>
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold tracking-wide text-accent sm:text-sm">
                LIVE VOICE &amp; TRADING COMMUNITY
              </span>
            </div>

            <h1 className="mb-5 animate-rise-in text-4xl font-extrabold leading-tight sm:text-5xl md:text-6xl" style={stagger(1)}>
              Where Traders
              <br />
              <span className="bg-gradient-to-r from-accent via-sky-400 to-violet-400 bg-clip-text text-transparent">
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
                className="btn-shine group inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-accent-hover hover:shadow-accent/30 sm:text-base"
              >
                <span>Join Elonix</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            {/* Who's online */}
            <div className="mt-12 flex animate-rise-in flex-col items-center gap-3" style={stagger(4)}>
              <div className="flex items-center -space-x-2">
                {ONLINE_NAMES.map((name, i) => (
                  <span key={name} className="inline-flex animate-float" style={{ animationDelay: `${i * -0.7}s` }}>
                    <Avatar name={name} size="md" className="ring-2 ring-base" />
                  </span>
                ))}
                <div className="z-10 flex h-9 w-9 items-center justify-center rounded-full bg-panel text-xs font-semibold text-text-secondary ring-2 ring-base">
                  +2k
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs text-text-muted sm:text-sm">
                <Radio className="h-3.5 w-3.5 animate-pulse text-success" />
                Building with traders worldwide, live right now
              </p>
            </div>
          </section>

          {/* Stats */}
          <section className="mx-auto max-w-3xl pb-16">
            <Reveal className="grid grid-cols-3 gap-4 rounded-2xl border border-border bg-panel/50 px-4 py-6">
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
                  className="group h-full rounded-2xl border border-border bg-panel/60 p-5 transition-all duration-300 hover:scale-105 hover:border-accent/30"
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

          <Reveal>
            <HubTeaser />
          </Reveal>

          {/* Secondary CTA strip */}
          <section className="mx-auto max-w-5xl pb-20">
            <Reveal className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-panel via-base to-panel p-8 text-center sm:p-12">
              <div className="absolute -top-10 -left-10 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
              <div className="absolute -bottom-10 -right-10 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />
              <div className="relative z-10">
                <TrendingUp className="mx-auto mb-4 h-8 w-8 text-emerald-400" />
                <h2 className="mb-3 text-2xl font-extrabold sm:text-3xl">Ready to talk markets live?</h2>
                <p className="mx-auto mb-7 max-w-xl text-sm text-text-secondary sm:text-base">
                  Sign in with Google and jump straight into voice and text channels built for
                  traders.
                </p>
                <button
                  onClick={() => navigate('/login')}
                  className="btn-shine inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-accent-hover sm:text-base"
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
