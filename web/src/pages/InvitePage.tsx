import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InviteInvalidReason, InvitePreview } from '@streaming/shared-types';
import { Clock, Globe, Hash, Link2Off, Lock, MailX, Users, Volume2, WifiOff } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useChannels } from '../context/ChannelsContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../lib/api';
import { acceptInvite, getInvitePreview } from '../lib/channels';
import NoticeScreen from '../components/NoticeScreen';
import ErrorBanner from '../components/ErrorBanner';
import Spinner, { FullPageSpinner } from '../components/Spinner';

const INVALID_COPY: Record<InviteInvalidReason, { title: string; message: string; icon: ReactNode }> = {
  expired: {
    title: 'This invite has expired',
    message: 'Invite links stop working after a while. Ask a channel owner or moderator for a fresh link.',
    icon: <Clock size={28} />,
  },
  revoked: {
    title: 'This invite was revoked',
    message: 'The person who created it turned this link off. Ask the channel for a new invite.',
    icon: <Link2Off size={28} />,
  },
  exhausted: {
    title: 'This invite has been fully used',
    message: 'It reached its maximum number of uses. Ask a channel owner or moderator for a new link.',
    icon: <Users size={28} />,
  },
  not_found: {
    title: 'Invite not found',
    message: "This link isn't valid. Check that you copied the whole link, or ask for a new one.",
    icon: <MailX size={28} />,
  },
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: InvitePreview };

export default function InvitePage() {
  const { token: inviteToken = '' } = useParams<{ token: string }>();
  const { session } = useSession();
  const { refresh } = useChannels();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const token = session?.accessToken;

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token || !inviteToken) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    setJoinError(null);
    getInvitePreview(token, inviteToken)
      .then((preview) => !cancelled && setState({ kind: 'ready', preview }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: 'ready', preview: { valid: false, reason: 'not_found', channel: null, alreadyMember: false } });
        } else {
          setState({ kind: 'error', message: (err as Error).message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, inviteToken, reloadKey]);

  const join = useCallback(async () => {
    if (!token) return;
    setJoining(true);
    setJoinError(null);
    try {
      const { channel, alreadyMember } = await acceptInvite(token, inviteToken);
      await refresh();
      if (!alreadyMember) showToast(`You joined #${channel.name}.`, 'success');
      navigate(`/channels/${channel.id}`, { replace: true });
    } catch (err) {
      const e = err as ApiError;
      const reasonByCode: Record<string, InviteInvalidReason> = {
        invite_expired: 'expired',
        invite_revoked: 'revoked',
        invite_exhausted: 'exhausted',
        invite_not_found: 'not_found',
      };
      const reason = e instanceof ApiError ? reasonByCode[e.code] : undefined;
      if (reason) {
        // The link went bad between preview and accept: show the matching explanation.
        setState((prev) => ({
          kind: 'ready',
          preview: {
            valid: false,
            reason,
            channel: prev.kind === 'ready' ? prev.preview.channel : null,
            alreadyMember: false,
          },
        }));
      } else {
        setJoinError(e.message || 'Could not join this channel.');
      }
      setJoining(false);
    }
  }, [token, inviteToken, refresh, showToast, navigate]);

  if (state.kind === 'loading') return <FullPageSpinner label="Checking invite…" />;

  if (state.kind === 'error') {
    return (
      <NoticeScreen
        icon={<WifiOff size={28} />}
        tone="warning"
        title="Couldn't check this invite"
        message={state.message}
        actionLabel="Back to channels"
        actionTo="/channels"
      >
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          type="button"
          className="tap mt-4 rounded-lg bg-hover px-4 py-2 text-sm font-medium text-text-primary hover:bg-border"
        >
          Try again
        </button>
      </NoticeScreen>
    );
  }

  const { preview } = state;
  const channel = preview.channel;

  if (!preview.valid) {
    const copy = INVALID_COPY[preview.reason ?? 'not_found'];
    return (
      <NoticeScreen icon={copy.icon} tone="warning" title={copy.title} message={copy.message} actionLabel="Back to channels" actionTo="/channels">
        {preview.alreadyMember && channel && (
          <Link
            to={`/channels/${channel.id}`}
            className="mt-4 rounded-lg bg-hover px-4 py-2 text-sm font-medium text-text-primary hover:bg-border"
          >
            You're already in #{channel.name} — open it
          </Link>
        )}
      </NoticeScreen>
    );
  }

  if (!channel) {
    // Defensive: a valid preview always carries the channel.
    return <NoticeScreen icon={<MailX size={28} />} tone="warning" title="Invite not found" actionLabel="Back to channels" actionTo="/channels" />;
  }

  const KindIcon = channel.kind === 'voice' ? Volume2 : Hash;
  const kindLabel = channel.kind === 'voice' ? 'Voice channel' : 'Text channel';
  const isPrivate = channel.visibility === 'private';

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6 text-center shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">You've been invited to join</p>
        <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <KindIcon size={26} aria-hidden />
        </div>
        <h1 className="mt-3 break-words text-xl font-bold text-text-primary">#{channel.name}</h1>

        <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-text-secondary">
          <li className="flex items-center gap-1.5">
            <KindIcon size={13} aria-hidden /> {kindLabel}
          </li>
          <li className="flex items-center gap-1.5">
            {isPrivate ? <Lock size={13} aria-hidden /> : <Globe size={13} aria-hidden />} {isPrivate ? 'Private' : 'Public'}
          </li>
          <li className="flex items-center gap-1.5">
            <Users size={13} aria-hidden /> {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
          </li>
        </ul>

        {joinError && (
          <div className="mt-4 text-left" role="alert">
            <ErrorBanner message={joinError} onDismiss={() => setJoinError(null)} />
          </div>
        )}

        {preview.alreadyMember ? (
          <>
            <p className="mt-5 text-sm text-text-secondary">You're already a member of this channel.</p>
            <Link
              to={`/channels/${channel.id}`}
              className="tap mt-3 block w-full rounded-lg bg-accent px-5 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Open channel
            </Link>
          </>
        ) : (
          <button
            onClick={join}
            disabled={joining}
            type="button"
            className="tap mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining && <Spinner size={15} className="text-white" />}
            {joining ? 'Joining…' : `Join #${channel.name}`}
          </button>
        )}

        <Link to="/channels" className="tap mt-3 inline-flex items-center text-sm text-text-secondary hover:text-text-primary hover:underline">
          Not now
        </Link>
      </div>
    </div>
  );
}
