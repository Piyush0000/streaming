import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LineChart, Newspaper, Plus, Search, Users } from 'lucide-react';
import { useSession } from '../../context/SessionContext';
import { hubPath } from '../../lib/hub';
import { hubMarketPath } from '../../lib/hubMarket';
import { cx } from '../../lib/format';

export default function HubNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, initializing } = useSession();
  const urlQ = location.pathname === hubPath.search('').split('?')[0] ? new URLSearchParams(location.search).get('q') ?? '' : '';
  const [q, setQ] = useState(urlQ);
  useEffect(() => setQ(urlQ), [urlQ]);
  const headerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pages with their own sticky bars (Markets table header) need the real nav height, which
  // changes with the breakpoint. On phones the nav is not sticky, so the offset is 0.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const mq = window.matchMedia?.('(min-width: 640px)');
    const apply = () => {
      const h = mq && !mq.matches ? 0 : el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--hub-nav-h', `${Math.round(h)}px`);
    };
    apply();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply);
      ro.observe(el);
    }
    mq?.addEventListener?.('change', apply);
    return () => {
      ro?.disconnect();
      mq?.removeEventListener?.('change', apply);
      document.documentElement.style.removeProperty('--hub-nav-h');
    };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    inputRef.current?.blur(); // closes the phone keyboard so the results are visible
    navigate(hubPath.search(t));
  }

  return (
    <header ref={headerRef} className="z-30 border-b border-border bg-base/90 backdrop-blur sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <Link
          to={session ? '/channels' : '/'}
          aria-label="Back to home"
          className="hidden shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary sm:flex"
        >
          <ArrowLeft size={16} />
          <span className="hidden md:inline">Home</span>
        </Link>
        <Link to={hubPath.home} className="tap inline-flex shrink-0 items-center text-lg font-black tracking-tight" aria-label="Elonix Hub home">
          ELON<span className="text-accent">IX</span>
          <span className="ml-2 hidden text-sm font-semibold text-text-secondary sm:inline">Hub</span>
        </Link>
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, 100))}
            type="search"
            name="q"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="none"
            aria-label="Search Elonix Hub"
            placeholder="Search Hub"
            className="min-h-[44px] w-full rounded-full border border-border bg-panel/70 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-accent sm:min-h-0"
          />
        </form>
        <Link
          to={hubPath.submit}
          aria-label="Create post"
          className="tap inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-2.5 py-2 text-sm font-semibold text-text-secondary hover:border-accent/40 hover:text-text-primary"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Post</span>
        </Link>
        {!initializing &&
          (session ? (
            <button
              type="button"
              onClick={() => navigate('/channels')}
              className="hidden shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:block"
            >
              Open app
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login', { state: { from: location.pathname + location.search } })}
              className="tap shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
            >
              Sign in
            </button>
          ))}
      </div>
      <nav aria-label="Hub sections" className="hub-nav-row mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2 sm:px-4">
        <Link
          to={session ? '/channels' : '/'}
          className="tap inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-text-secondary hover:bg-hover hover:text-text-primary sm:hidden"
        >
          <ArrowLeft size={14} aria-hidden /> {session ? 'App' : 'Home'}
        </Link>
        {[
          { to: hubPath.home, label: 'Feed', icon: Users, end: true },
          { to: hubMarketPath.news, label: 'News', icon: Newspaper, end: false },
          { to: hubMarketPath.markets, label: 'Markets', icon: LineChart, end: false },
        ].map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'tap inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-xs',
                isActive ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
              )
            }
          >
            <Icon size={14} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
