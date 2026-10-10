import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FollowStats, Stream } from '@streaming/shared-types';
import { LogOut, Share2, Square, ShieldCheck, UserCheck, UserPlus } from 'lucide-react';
import { shareLink, shareToastMessage } from '../lib/share';
import { useToast } from '../context/ToastContext';
import Avatar from './Avatar';
import Modal from './Modal';
import Spinner from './Spinner';
import ErrorBanner from './ErrorBanner';
import Odometer from './Odometer';
import AvatarStack from './AvatarStack';
import type { StackPerson } from './AvatarStack';
import { LiveBadge } from '../pages/LivePage';

export default function StreamHeader({
  stream,
  speakingCount,
  listeningCount,
  showCounts,
  follow,
  canFollow,
  followBusy,
  onToggleFollow,
  canEnd,
  onEnd,
  onLeave,
  speakerPeople,
  listenerPeople,
}: {
  stream: Stream;
  speakingCount: number;
  listeningCount: number;
  /** Counts only make sense while connected to the room. */
  showCounts: boolean;
  follow: FollowStats | null;
  canFollow: boolean;
  followBusy: boolean;
  onToggleFollow: () => void;
  canEnd: boolean;
  onEnd: () => Promise<void>;
  onLeave: () => void;
  /** Real people currently on stage / listening (for the avatar stacks). */
  speakerPeople?: StackPerson[];
  listenerPeople?: StackPerson[];
}) {
  const live = stream.status === 'live';
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleShare() {
    const url = window.location.href;
    const t = shareToastMessage(await shareLink({ url, title: stream.title, text: `Join "${stream.title}" live on Elonix` }), url);
    if (t) showToast(t.message, t.kind);
  }

  async function handleEnd() {
    setEnding(true);
    setEndError(null);
    try {
      await onEnd();
      setConfirmEnd(false);
    } catch (err) {
      setEndError((err as Error).message);
    } finally {
      setEnding(false);
    }
  }

  return (
    <header className="glass relative z-10 flex animate-fade-in flex-col gap-2 border-x-0 border-t-0 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {live ? (
          <LiveBadge />
        ) : (
          <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
            Ended
          </span>
        )}
        <h1 className="min-w-0 flex-1 basis-40 truncate text-base font-semibold text-text-primary" title={stream.title}>
          {stream.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {canEnd && live && (
            <button
              onClick={() => setConfirmEnd(true)}
              className="tap flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Square size={13} fill="currentColor" /> End stream
            </button>
          )}
          <button type="button" onClick={() => void handleShare()} aria-label="Share this stream" className="tap flex items-center gap-1.5 rounded-lg bg-hover px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-border">
            <Share2 size={14} /> Share
          </button>
          <button
            onClick={onLeave}
            className="tap flex items-center gap-1.5 rounded-lg bg-hover px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-border"
          >
            <LogOut size={14} /> Leave
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={stream.hostUsername} size={24} glow={live} gradientRing={live} />
          <span className="truncate font-medium text-text-primary">{stream.hostUsername}</span>
          <span className="text-text-secondary">host</span>
        </span>
        {follow && (
          <span className="text-text-muted">
            {follow.followers} {follow.followers === 1 ? 'follower' : 'followers'}
          </span>
        )}
        {canFollow && follow && (
          <button
            onClick={onToggleFollow}
            disabled={followBusy}
            aria-pressed={follow.isFollowing}
            className={`tap flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
              follow.isFollowing ? 'bg-hover text-text-primary hover:bg-border' : 'cta-border text-white'
            }`}
          >
            {followBusy ? <Spinner size={12} /> : follow.isFollowing ? <UserCheck size={13} /> : <UserPlus size={13} />}
            {follow.isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
        {showCounts && live && (
          <span className="flex items-center gap-2 text-text-muted" aria-live="polite">
            <AvatarStack people={speakerPeople ?? []} size={22} max={4} label={`${speakingCount} on stage`} />
            <span className="inline-flex items-center gap-1">
              <Odometer value={speakingCount} className="text-text-primary" /> speaking
            </span>
            <span aria-hidden>·</span>
            <AvatarStack people={listenerPeople ?? []} size={22} max={4} label={`${listeningCount} listening`} />
            <span className="inline-flex items-center gap-1">
              <Odometer value={listeningCount} className="text-text-primary" /> listening
            </span>
          </span>
        )}
        <Link to="/guidelines" className="ml-auto flex min-h-[44px] items-center gap-1 text-text-secondary hover:text-accent md:min-h-0">
          <ShieldCheck size={13} /> Guidelines
        </Link>
      </div>

      {stream.description && (
        <p className="line-clamp-2 break-words text-xs text-text-secondary">{stream.description}</p>
      )}

      {confirmEnd && (
        <Modal title="End this stream?" onClose={() => setConfirmEnd(false)} size="sm" dismissible={!ending} tone="danger">
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-text-secondary">
              Everyone will be disconnected and the stream will end for good. Chat history stays viewable.
            </p>
            {endError && <ErrorBanner message={endError} />}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmEnd(false)} disabled={ending} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover disabled:opacity-60">
                Keep streaming
              </button>
              <button
                onClick={handleEnd}
                disabled={ending}
                className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {ending && <Spinner size={14} className="text-white" />} End stream
              </button>
            </div>
          </div>
        </Modal>
      )}
    </header>
  );
}
