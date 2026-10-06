import { Link, useNavigate } from 'react-router-dom';
import { Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLiveStreams } from '../context/LiveStreamsContext';
import ErrorBanner from '../components/ErrorBanner';
import { CardGridSkeleton } from '../components/Skeleton';
import { relativeTime } from '../lib/format';
import EmptyState from '../components/EmptyState';
import AnimatedBackground from '../components/AnimatedBackground';
import AvatarStack from '../components/AvatarStack';

/** /live - browse everything that's live right now, or start your own. */
export default function LivePage() {
  const { streams, loading, error, refresh, openGoLive } = useLiveStreams();
  const navigate = useNavigate();

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatedBackground variant="aurora" subtle />
      <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="live-badge flex h-9 w-9 items-center justify-center rounded-xl text-white">
              <Radio size={18} />
            </span>
            <div>
              <h1 className="text-gradient-anim text-lg font-bold">Live now</h1>
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
              className="cta-border flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ ['--cta-fill' as string]: '#be123c' }}
            >
              <Radio size={15} /> Go live
            </button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {loading && streams.length === 0 ? (
          <CardGridSkeleton count={3} />
        ) : streams.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border">
            <EmptyState
              character="astronaut"
              title="Nobody is live right now"
              body="Be the first - hosts with Elonix bot premium or 500 followers can start a stream."
            >
              <button
                onClick={openGoLive}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Start a stream
              </button>
            </EmptyState>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {streams.map((s, i) => (
              <li key={s.id} className="stagger" style={{ ['--i' as string]: Math.min(i, 8) }}>
                <button
                  onClick={() => navigate(`/live/${s.id}`)}
                  className="hover-lift glass glass-glow flex h-full w-full flex-col gap-3 rounded-2xl p-4 text-left"
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
                    <AvatarStack people={[{ key: s.hostId, name: s.hostUsername }]} size={26} label={`Hosted by ${s.hostUsername}`} />
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
    </div>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={`live-badge inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${className ?? ''}`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inset-0 animate-live-ping rounded-full bg-white" />
        <span className="relative h-1.5 w-1.5 animate-pulse-ring rounded-full bg-white" />
      </span>
      Live
    </span>
  );
}
