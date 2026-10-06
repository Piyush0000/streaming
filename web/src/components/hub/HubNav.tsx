import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { useSession } from '../../context/SessionContext';
import { hubPath } from '../../lib/hub';

export default function HubNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, initializing } = useSession();
  const urlQ = location.pathname === hubPath.search('').split('?')[0] ? new URLSearchParams(location.search).get('q') ?? '' : '';
  const [q, setQ] = useState(urlQ);
  useEffect(() => setQ(urlQ), [urlQ]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (t) navigate(hubPath.search(t));
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-base/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <Link
          to={session ? '/channels' : '/'}
          aria-label="Back to home"
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
        >
          <ArrowLeft size={16} />
          <span className="hidden md:inline">Home</span>
        </Link>
        <Link to={hubPath.home} className="shrink-0 text-lg font-black tracking-tight" aria-label="Elonix Hub home">
          ELON<span className="text-accent">IX</span>
          <span className="ml-2 hidden text-sm font-semibold text-text-secondary sm:inline">Hub</span>
        </Link>
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, 100))}
            type="search"
            aria-label="Search Elonix Hub"
            placeholder="Search Elonix Hub"
            className="w-full rounded-full border border-border bg-panel/70 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-accent"
          />
        </form>
        <Link
          to={hubPath.submit}
          aria-label="Create post"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-sm font-semibold text-text-secondary hover:border-accent/40 hover:text-text-primary"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Post</span>
        </Link>
        {!initializing &&
          (session ? (
            <button
              onClick={() => navigate('/channels')}
              className="hidden shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:block"
            >
              Open app
            </button>
          ) : (
            <button
              onClick={() => navigate('/login', { state: { from: location.pathname + location.search } })}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
            >
              Sign in
            </button>
          ))}
      </div>
    </header>
  );
}
