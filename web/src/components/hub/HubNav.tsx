import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '../../context/SessionContext';

export default function HubNav() {
  const navigate = useNavigate();
  const { session, initializing } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-base/85 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={session ? '/channels' : '/'}
            aria-label="Back to home"
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <span className="text-lg font-black tracking-tight">
            ELON<span className="text-accent">IX</span>
            <span className="ml-2 text-sm font-semibold text-text-secondary">Hub</span>
          </span>
        </div>
        {!initializing &&
          (session ? (
            <button
              onClick={() => navigate('/channels')}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Open app
            </button>
          ) : (
            <button
              onClick={() => navigate('/login', { state: { from: '/elonixhub' } })}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:border-accent/40 hover:text-text-primary"
            >
              Sign in
            </button>
          ))}
      </div>
    </header>
  );
}
