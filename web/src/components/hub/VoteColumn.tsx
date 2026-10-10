import { useEffect, useRef, useState } from 'react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { compactCount, type VoteResult, type VoteValue } from '../../lib/hub';
import { cx } from '../../lib/format';
import { useToast } from '../../context/ToastContext';

/** Optimistic vote state with rollback. `send` performs the request (caller binds token/id). */
export function useVote(
  initial: { score: number; myVote: VoteValue },
  send: (value: VoteValue) => Promise<VoteResult>,
  requireAuth: () => boolean
) {
  const { showToast } = useToast();
  const [state, setState] = useState(initial);
  const busy = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  // Re-sync when the parent hands us a different server snapshot (e.g. feed refetch).
  useEffect(() => {
    if (!busy.current) setState({ score: initial.score, myVote: initial.myVote });
  }, [initial.score, initial.myVote]);

  function cast(dir: 1 | -1) {
    if (!requireAuth() || busy.current) return;
    const prev = state;
    const next: VoteValue = prev.myVote === dir ? 0 : dir;
    setState({ score: prev.score + next - prev.myVote, myVote: next });
    busy.current = true;
    sendRef
      .current(next)
      .then((r) => setState({ score: r.score, myVote: r.myVote }))
      .catch((err) => {
        setState(prev);
        showToast(err instanceof Error ? err.message : 'Could not register your vote.', 'error');
      })
      .finally(() => {
        busy.current = false;
      });
  }
  return { ...state, cast };
}

interface Props {
  score: number;
  myVote: VoteValue;
  onUp: () => void;
  onDown: () => void;
  horizontal?: boolean;
  size?: 'sm' | 'md';
}

/** Up/down arrows with an animated score. Orange = upvoted, violet = downvoted. */
export default function VoteColumn({ score, myVote, onUp, onDown, horizontal, size = 'md' }: Props) {
  const icon = size === 'sm' ? 18 : 22;
  const btn = 'hit inline-flex items-center justify-center rounded-md p-1 transition-colors duration-fast hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <div
      role="group"
      aria-label="Vote"
      className={cx('flex items-center', horizontal ? 'flex-row gap-1' : 'flex-col gap-0.5')}
    >
      <button
        type="button"
        onClick={onUp}
        aria-pressed={myVote === 1}
        aria-label="Upvote"
        className={cx(btn, myVote === 1 ? 'text-orange-400' : 'text-text-muted hover:text-orange-300')}
      >
        <ArrowBigUp size={icon} className={cx(myVote === 1 && 'fill-orange-400', myVote === 1 && 'animate-heart-bump')} />
      </button>
      <span
        key={score}
        aria-label={`Score ${score}`}
        className={cx(
          'inline-block min-w-[1.5rem] animate-tick text-center text-xs font-bold tabular-nums',
          myVote === 1 ? 'text-orange-400' : myVote === -1 ? 'text-violet-400' : 'text-text-primary'
        )}
      >
        {compactCount(score)}
      </span>
      <button
        type="button"
        onClick={onDown}
        aria-pressed={myVote === -1}
        aria-label="Downvote"
        className={cx(btn, myVote === -1 ? 'text-violet-400' : 'text-text-muted hover:text-violet-300')}
      >
        <ArrowBigDown size={icon} className={cx(myVote === -1 && 'fill-violet-400', myVote === -1 && 'animate-heart-bump')} />
      </button>
    </div>
  );
}
