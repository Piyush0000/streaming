import { Loader2 } from 'lucide-react';
import ErrorBanner from './ErrorBanner';
import Dots from './Dots';
import { useCountdown } from '../hooks/useCountdown';
import type { JoinFailureKind } from '../lib/errorMessages';

/**
 * Inline join/reconnect status for a room: a non-blocking "Reconnecting" line while
 * auto-retrying, and an error banner with a Retry button (and rate-limit countdown)
 * when it gave up. Always shows friendly text; a failed join leaves it retryable.
 */
export default function JoinStatusBanner({
  status,
  error,
  kind,
  fatal,
  retryAt,
  onRetry,
  noun = 'room',
}: {
  status: 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'error';
  error: string | null;
  kind?: JoinFailureKind | null;
  fatal?: boolean;
  retryAt?: number | null;
  onRetry: () => void;
  noun?: string;
}) {
  const waitSecs = useCountdown(kind === 'rate_limited' ? retryAt : null);

  if (status === 'connecting') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-text-secondary" role="status">
        Joining the {noun} <Dots />
      </p>
    );
  }
  if (status === 'reconnecting') {
    return (
      <p
        role="status"
        className="flex w-fit items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-text-primary"
      >
        <Loader2 size={14} className="animate-spin text-warning" />
        {error ?? "Can't reach Elonix right now. Retrying…"}
      </p>
    );
  }
  if (status === 'error' && error) {
    const label = kind === 'full' ? 'Try again' : kind === 'transient' || kind === 'other' || !kind ? 'Retry' : 'Retry';
    return (
      <div className="flex flex-col gap-2" role="alert">
        <ErrorBanner message={error} />
        {!fatal && (
          <button
            onClick={onRetry}
            disabled={waitSecs > 0}
            className="tap inline-flex w-fit items-center justify-center rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {waitSecs > 0 ? `Retry in ${waitSecs}s` : label}
          </button>
        )}
      </div>
    );
  }
  return null;
}
