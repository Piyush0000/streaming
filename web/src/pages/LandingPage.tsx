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

const FEATURES = [
  {
    icon: Mic,
    iconClass: 'text-accent',
    title: 'Voice Channels',
    sub: 'Hop into live audio rooms with traders, anytime.',
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

const ONLINE_NAMES = ['Ava Chen', 'Marcus Lee', 'Priya Raman', 'Diego Soto', 'Nina Park', 'Omar Ali'];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] w-full overflow-hidden bg-base text-text-primary relative">
      {/* Animated background orbs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -left-20 -top-20 w-96 h-96 rounded-full bg-gradient-to-br from-accent/20 via-accent/5 to-transparent blur-3xl animate-pulse opacity-60" />
        <div
          className="absolute right-0 top-10 w-80 h-80 rounded-full bg-gradient-to-br from-sky-400/10 via-accent/5 to-transparent blur-3xl animate-pulse opacity-50"
          style={{ animationDelay: '200ms' }}
        />
        <div
          className="absolute left-1/2 top-1/3 w-72 h-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-violet-400/10 via-accent/5 to-transparent blur-3xl animate-pulse opacity-40"
          style={{ animationDelay: '400ms' }}
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <span className="text-lg font-black tracking-tight">
            ELON<span className="text-accent">IX</span>
          </span>
          <button
            onClick={() => navigate('/login')}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
          >
            Sign in
          </button>
        </header>

        <main className="flex-1 px-5 sm:px-8">
          {/* Hero */}
          <section className="mx-auto max-w-4xl pt-10 pb-16 text-center sm:pt-16 sm:pb-20">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 animate-pulse">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold tracking-wide text-accent sm:text-sm">
                LIVE VOICE &amp; TRADING COMMUNITY
              </span>
            </div>

            <h1 className="mb-5 text-4xl font-extrabold leading-tight sm:text-5xl md:text-6xl">
              Where Traders
              <br />
              <span className="bg-gradient-to-r from-accent via-sky-400 to-violet-400 bg-clip-text text-transparent">
                Talk Live
              </span>
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              Voice channels, live chat, and screen-shared charts — Elonix is the real-time
              community layer for the <span className="font-semibold text-accent">AI-powered trading</span> crowd.
              Drop into a room, share your screen, and talk setups as the market moves.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={() => navigate('/login')}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-accent-hover hover:shadow-accent/30 sm:text-base"
              >
                <span>Join Elonix</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            {/* Who's online */}
            <div className="mt-12 flex flex-col items-center gap-3">
              <div className="flex items-center -space-x-2">
                {ONLINE_NAMES.map((name) => (
                  <Avatar key={name} name={name} size={36} className="ring-2 ring-base" />
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

          {/* Feature cards */}
          <section className="mx-auto max-w-5xl pb-20">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, iconClass, title, sub }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-border bg-panel/60 p-5 transition-all duration-300 hover:scale-105 hover:border-accent/30"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
                    <Icon className={`h-5 w-5 ${iconClass}`} />
                  </div>
                  <h3 className="mb-1 text-sm font-bold text-text-primary sm:text-base">{title}</h3>
                  <p className="text-xs text-text-secondary sm:text-sm">{sub}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Secondary CTA strip */}
          <section className="mx-auto max-w-5xl pb-20">
            <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-panel via-base to-panel p-8 text-center sm:p-12">
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
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-accent-hover sm:text-base"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-border px-5 py-6 text-center text-xs text-text-muted sm:px-8">
          © {new Date().getFullYear()} Elonix. Part of the Elonix trading suite.
        </footer>
      </div>
    </div>
  );
}
