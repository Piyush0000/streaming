import { Link, useNavigate } from 'react-router-dom';
import { Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLiveStreams } from '../context/LiveStreamsContext';
import Avatar from '../components/Avatar';
import ErrorBanner from '../components/ErrorBanner';
import { CardGridSkeleton } from '../components/Skeleton';
import { relativeTime } from '../lib/format';

/** /live - browse everything that's live right now, or start your own. */
export default function LivePage() {
  const { streams, loading, error, refresh, openGoLive } = useLiveStreams();
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger/15 text-danger">
              <Radio size={18} />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Live now</h1>
              <p className="text-xs text-text-muted">Listen in, ask to speak, and chat with the host.</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="rounded-lg p-2 text-text-secondary hover:bg-hover hover:text-text-primary"
              aria-label="Refresh live streams"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={openGoLive}
              className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Radio size={15} /> Go live
            </button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {loading && streams.length === 0 ? (
          <CardGridSkeleton count={3} />
        ) : streams.length === 0 ? (
          <div className="flex animate-rise-in flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <Radio size={30} className="mb-3 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">Nobody is live right now</p>
            <p className="mt-1 max-w-sm text-xs text-text-muted">
              Be the first - hosts with Elonix bot premium or 500 followers can start a stream.
            </p>
            <button
              onClick={openGoLive}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Start a stream
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {streams.map((s, i) => (
              <li key={s.id} className="animate-rise-in" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <button
                  onClick={() => navigate(`/live/${s.id}`)}
                  className="hover-lift flex h-full w-full flex-col gap-3 rounded-2xl border border-border bg-panel p-4 text-left transition-colors hover:border-accent/40 hover:bg-hover"
                >
                  <div className="flex items-center gap-2">
                    <LiveBadge />
                    <span className="text-[11px] text-text-muted">started {relativeTime(s.startedAt)}</span>
                  </div>
                  <h2 className="line-clamp-2 break-words text-sm font-semibold text-text-primary">{s.title}</h2>
                  {s.description && (
                    <p className="line-clamp-2 break-words text-xs text-text-secondary">{s.description}</p>
                  )}
                  <div className="mt-auto flex items-center gap-2">
                    <Avatar name={s.hostUsername} size="sm" glow />
                    <span className="truncate text-xs text-text-secondary">{s.hostUsername}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Link
          to="/guidelines"
          className="flex w-fit items-center gap-1.5 text-xs text-text-muted hover:text-accent"
        >
          <ShieldCheck size={13} /> Community guidelines
        </Link>
      </div>
    </div>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${className ?? ''}`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inset-0 animate-live-ping rounded-full bg-white" />
        <span className="relative h-1.5 w-1.5 animate-pulse-ring rounded-full bg-white" />
      </span>
      Live
    </span>
  );
}
