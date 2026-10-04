import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  FollowStats,
  Message,
  ModerationUserState,
  Stream,
  StreamViewerState,
  StreamWarningPayload,
} from '@streaming/shared-types';
import { STREAM_MAX_WARNINGS } from '../lib/streamLimits';
import { Ban, Hand, Info, Lock, Radio, SearchX, ShieldAlert, UserX } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { useLiveStreams } from '../context/LiveStreamsContext';
import { useChannelRemoved } from '../hooks/useChannelRemoved';
import { ApiError } from '../lib/api';
import {
  endStream,
  followUser,
  getFollowStats,
  getStream,
  listModeration,
  moderate,
  unfollowUser,
} from '../lib/streams';
import { useStreamMedia } from '../hooks/useStreamMedia';
import type { Participant } from '../hooks/useStreamMedia';
import { useStreamChat } from '../hooks/useStreamChat';
import StreamHeader from '../components/StreamHeader';
import StreamStage from '../components/StreamStage';
import StageControls from '../components/StageControls';
import ParticipantList from '../components/ParticipantList';
import SpeakRequestQueue from '../components/SpeakRequestQueue';
import ModerationMenu from '../components/ModerationMenu';
import type { ModerationTarget, ParticipantAction } from '../components/ModerationMenu';
import ModerationDialog from '../components/ModerationDialog';
import ModerationPanel from '../components/ModerationPanel';
import WarningModal from '../components/WarningModal';
import RemoteAudioSink from '../components/RemoteAudioSink';
import NoticeScreen from '../components/NoticeScreen';
import MessageList from '../components/MessageList';
import type { MessageAction } from '../components/MessageList';
import MessageComposer from '../components/MessageComposer';
import ErrorBanner from '../components/ErrorBanner';
import { StreamPageSkeleton } from '../components/Skeleton';
import Dots from '../components/Dots';
import { cx } from '../lib/format';

type SideTab = 'chat' | 'requests' | 'moderation';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; stream: Stream; me: StreamViewerState };

interface RemovedNotice {
  action: 'kick' | 'ban';
  reason?: string;
  fromChat: boolean;
}

export default function StreamPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const { session, logout } = useSession();
  const { showToast } = useToast();
  const { refresh: refreshLive } = useLiveStreams();
  const navigate = useNavigate();
  const { handleChannelRemoved } = useChannelRemoved();

  const token = session?.accessToken;
  const selfId = session?.user.id ?? '';
  const selfName = session?.user.username ?? '';

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [ended, setEnded] = useState(false);
  const [removed, setRemoved] = useState<RemovedNotice | null>(null);
  const [warning, setWarning] = useState<StreamWarningPayload | null>(null);
  const [tab, setTab] = useState<SideTab>('chat');
  const [accessDenied, setAccessDenied] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  // ---- stream detail ------------------------------------------------------

  useEffect(() => {
    if (!token || !streamId) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    setEnded(false);
    setRemoved(null);
    setWarning(null);
    setAccessDenied(false);
    setTab('chat');
    getStream(token, streamId)
      .then(({ stream, me }) => !cancelled && setLoad({ kind: 'ready', stream, me }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setLoad({ kind: 'not_found' });
        else setLoad({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [token, streamId, reloadKey]);

  const stream = load.kind === 'ready' ? load.stream : null;
  const viewer = load.kind === 'ready' ? load.me : null;
  const isHost = !!viewer?.isHost;
  const isManager = !!viewer && (viewer.isHost || viewer.isAdmin);
  const isLive = !!stream && stream.status === 'live' && !ended;
  const banned = !!viewer?.banned;
  const inRoom = load.kind === 'ready' && !banned && !removed;

  const markEnded = useCallback(() => {
    setEnded(true);
    refreshLive();
  }, [refreshLive]);

  const handleRemoved = useCallback((notice: RemovedNotice) => {
    // Chat carries the exact action (kick vs ban) and reason, so it wins over the generic media notice.
    setRemoved((prev) => (!prev || (notice.fromChat && !prev.fromChat) ? notice : prev));
  }, []);

  // ---- chat -----------------------------------------------------------------

  const chat = useStreamChat({
    streamId,
    token,
    selfUserId: selfId,
    enabled: inRoom,
    initialMuted: !!viewer?.muted,
    events: {
      onWarning: (w) => setWarning(w),
      onRemoved: (p) => handleRemoved({ action: p.action, reason: p.reason, fromChat: true }),
      onEnded: markEnded,
      onAuthError: logout,
      onAccessDenied: () => setAccessDenied(true),
      onChannelRemoved: (p) => handleChannelRemoved(p, { current: p.channelId === streamId, fallbackPath: '/live' }),
    },
  });

  const prevMuted = useRef(chat.muted);
  useEffect(() => {
    if (prevMuted.current !== chat.muted) {
      showToast(chat.muted ? 'The host muted you in chat.' : 'You can chat again.', chat.muted ? 'warning' : 'success');
      prevMuted.current = chat.muted;
    }
  }, [chat.muted, showToast]);

  // ---- media ----------------------------------------------------------------

  const media = useStreamMedia({
    streamId,
    token,
    enabled: inRoom && isLive,
    selfUsername: selfName,
    events: {
      onRemoved: (reason) => handleRemoved({ action: 'kick', reason, fromChat: false }),
      onEnded: markEnded,
      notify: showToast,
    },
  });

  // ---- follow ----------------------------------------------------------------

  const [follow, setFollow] = useState<FollowStats | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const hostId = stream?.hostId;
  useEffect(() => {
    if (!token || !hostId) return;
    let cancelled = false;
    getFollowStats(token, hostId)
      .then((s) => !cancelled && setFollow(s))
      .catch(() => !cancelled && setFollow(null));
    return () => {
      cancelled = true;
    };
  }, [token, hostId]);

  async function toggleFollow() {
    if (!token || !hostId || !follow) return;
    setFollowBusy(true);
    try {
      setFollow(follow.isFollowing ? await unfollowUser(token, hostId) : await followUser(token, hostId));
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setFollowBusy(false);
    }
  }

  // ---- moderation list (host / admin) ----------------------------------------

  const [modUsers, setModUsers] = useState<ModerationUserState[]>([]);
  const [modLoading, setModLoading] = useState(false);
  const [modError, setModError] = useState<string | null>(null);

  const refreshModeration = useCallback(async () => {
    if (!token || !streamId || !isManager) return;
    setModLoading(true);
    try {
      setModUsers(await listModeration(token, streamId));
      setModError(null);
    } catch (err) {
      setModError((err as Error).message);
    } finally {
      setModLoading(false);
    }
  }, [token, streamId, isManager]);

  useEffect(() => {
    if (!isManager || !isLive) return;
    refreshModeration();
    const t = window.setInterval(refreshModeration, 20000);
    return () => window.clearInterval(t);
  }, [isManager, isLive, refreshModeration]);

  const modMap = useMemo(() => new Map(modUsers.map((u) => [u.userId, u])), [modUsers]);

  // ---- manager actions ----------------------------------------------------------

  const [dialog, setDialog] = useState<{ action: ParticipantAction; target: ModerationTarget } | null>(null);

  function openAction(action: ParticipantAction, target: ModerationTarget) {
    setDialog({ action, target });
    // Fresh warning counts before the confirmation text is read.
    refreshModeration();
  }

  async function runAction(
    action: ParticipantAction,
    target: ModerationTarget,
    reason: string
  ): Promise<string | void> {
    if (!token || !streamId) return;
    const name = target.username;
    if (action === 'demote') {
      await media.demoteUser(target.userId);
      showToast(`${name} moved back to listeners.`, 'success');
      return;
    }
    if (action === 'remove') {
      await media.removeUserFromRoom(target.userId);
      showToast(`${name} was removed from the room (they can rejoin).`, 'success');
      return;
    }
    try {
      const res = await moderate(token, streamId, target.userId, action, reason || undefined);
      refreshModeration();
      if (res.autoEscalated) {
        return `${name} already had ${STREAM_MAX_WARNINGS} warnings, so this warning automatically banned them and removed them from the stream.`;
      }
      if (action === 'warn') {
        return `Warned ${name}. They are now at ${res.warnings ?? '?'} of ${res.max ?? STREAM_MAX_WARNINGS} warnings.`;
      }
      const done: Record<string, string> = {
        mute: `${name} is muted in chat.`,
        unmute: `${name} can chat again.`,
        kick: `${name} was kicked from the stream.`,
        ban: `${name} was banned and removed from the stream.`,
        unban: `${name} was unbanned and can rejoin.`,
      };
      showToast(done[res.action] ?? done[action], 'success');
    } catch (err) {
      // Surface the server's explanation (e.g. "Platform admins cannot be moderated.").
      throw err instanceof Error ? err : new Error('Action failed.');
    }
  }

  function renderParticipantActions(p: Participant) {
    if (!isManager || p.isSelf || p.role === 'host') return null;
    const state = modMap.get(p.userId);
    return (
      <ModerationMenu
        target={{ userId: p.userId, username: p.username || 'Guest' }}
        role={p.role}
        warnings={state?.warnings ?? 0}
        muted={!!state?.muted}
        onAction={openAction}
      />
    );
  }

  // ---- end / leave ----------------------------------------------------------------

  async function handleEndStream() {
    if (!token || !streamId) return;
    try {
      await endStream(token, streamId);
    } catch (err) {
      // Already ended elsewhere is fine; anything else is surfaced to the dialog.
      if (!(err instanceof ApiError && err.code === 'stream_already_ended')) throw err;
    }
    markEnded();
    showToast('Stream ended.', 'success');
  }

  // ---- chat message menu ------------------------------------------------------------

  const messageActions = useCallback(
    (m: Message): MessageAction[] => {
      const actions: MessageAction[] = [];
      const mine = m.userId === selfId;
      if (mine || isManager) {
        actions.push({ label: 'Delete message', danger: true, onSelect: () => chat.remove(m.id) });
      }
      if (isManager && isLive && !mine && m.userId !== stream?.hostId) {
        const target = { userId: m.userId, username: m.username };
        const muted = modMap.get(m.userId)?.muted;
        actions.push({ label: 'Warn user', onSelect: () => openAction('warn', target) });
        actions.push(
          muted
            ? { label: 'Unmute user', onSelect: () => openAction('unmute', target) }
            : { label: 'Mute user', onSelect: () => openAction('mute', target) }
        );
      }
      return actions;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selfId, isManager, isLive, stream?.hostId, modMap, chat.remove]
  );

  // ---- derived UI data ----------------------------------------------------------------

  const listeners = media.participants.filter((p) => p.role === 'listener');
  const speakingCount = media.participants.length - listeners.length;
  const connected = media.status === 'connected';

  // ---- early states ---------------------------------------------------------------------

  if (!streamId) return null;

  if (load.kind === 'loading') return <StreamPageSkeleton />;

  if (load.kind === 'not_found') {
    return (
      <NoticeScreen
        icon={<SearchX size={28} />}
        title="Stream not found"
        message="This stream doesn't exist or the link is wrong."
      />
    );
  }

  if (load.kind === 'error') {
    return (
      <NoticeScreen icon={<Info size={28} />} title="Couldn't load this stream" message={load.message} tone="warning">
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-4 rounded-lg bg-hover px-4 py-2 text-sm font-medium text-text-primary hover:bg-border"
        >
          Try again
        </button>
      </NoticeScreen>
    );
  }

  if (accessDenied) {
    return (
      <NoticeScreen
        icon={<Lock size={28} />}
        tone="warning"
        title="You don't have access to this stream"
        message="You can no longer see this room."
      />
    );
  }

  if (removed) {
    const isBan = removed.action === 'ban';
    return (
      <NoticeScreen
        icon={isBan ? <Ban size={28} /> : <UserX size={28} />}
        tone="danger"
        title={isBan ? 'You were banned from this stream' : 'You were removed from this stream'}
        message={removed.reason ? `Reason: ${removed.reason}` : isBan ? 'You cannot rejoin this stream.' : undefined}
      />
    );
  }

  if (banned) {
    return (
      <NoticeScreen
        icon={<Ban size={28} />}
        tone="danger"
        title="You are banned from this stream"
        message="The host banned you, so you can't watch or chat in this stream."
      />
    );
  }

  const s = load.stream;
  const requestCount = media.pendingRequests.length;

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex min-w-0 flex-col lg:flex-1 lg:overflow-y-auto">
        <StreamHeader
          stream={{ ...s, status: isLive ? 'live' : 'ended' }}
          speakingCount={speakingCount}
          listeningCount={listeners.length}
          showCounts={connected}
          follow={follow}
          canFollow={!isHost && s.hostId !== selfId}
          followBusy={followBusy}
          onToggleFollow={toggleFollow}
          canEnd={isManager}
          onEnd={handleEndStream}
          onLeave={() => navigate('/live')}
        />

        <div className="flex flex-col gap-5 p-4">
          {!isLive && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-panel px-6 py-8 text-center">
              <Radio size={26} className="text-text-muted" />
              <p className="text-base font-semibold text-text-primary">This stream has ended</p>
              <p className="text-sm text-text-secondary">You can still read the chat history.</p>
              <button
                onClick={() => navigate('/live')}
                className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Back to live streams
              </button>
            </div>
          )}

          {isLive && media.status === 'connecting' && (
            <p className="flex items-center gap-1.5 text-sm text-text-secondary">
              Joining the room <Dots />
            </p>
          )}

          {isLive && media.status === 'error' && media.joinError && (
            <div className="flex flex-col gap-2">
              <ErrorBanner message={media.joinError} />
              {!media.joinFatal && (
                <button
                  onClick={media.reconnect}
                  className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  {media.joinError.includes('full') ? 'Try again' : 'Reconnect'}
                </button>
              )}
            </div>
          )}

          {media.mediaError && <ErrorBanner message={media.mediaError} onDismiss={media.dismissMediaError} />}

          {isLive && isManager && requestCount > 0 && tab !== 'requests' && (
            <button
              onClick={() => {
                setTab('requests');
                asideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="flex animate-slide-down items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-left text-sm text-text-primary hover:bg-accent-muted"
            >
              <Hand size={15} className="origin-bottom animate-wiggle text-accent" />
              {requestCount} {requestCount === 1 ? 'person wants' : 'people want'} to speak - review
            </button>
          )}

          {isLive && (
            <>
              <StreamStage
                hostId={s.hostId}
                hostUsername={s.hostUsername}
                participants={media.participants}
                audioByUserId={media.audioByUserId}
                micStream={media.micStream}
                selfMuted={media.muted}
                screens={media.screens}
                renderActions={renderParticipantActions}
              />

              {connected && media.myRole && (
                <StageControls
                  role={media.myRole}
                  micState={media.micState}
                  micError={media.micError}
                  muted={media.muted}
                  onToggleMute={media.toggleMute}
                  onRetryMic={media.retryMic}
                  isSharingScreen={media.isSharingScreen}
                  onStartScreenShare={media.startScreenShare}
                  onStopScreenShare={media.stopScreenShare}
                  speakRequest={media.speakRequest}
                  onRequestSpeak={media.requestSpeak}
                  onCancelSpeakRequest={media.cancelSpeakRequest}
                  speakCooldownUntil={media.speakCooldownUntil}
                />
              )}

              {connected && <ParticipantList listeners={listeners} renderActions={renderParticipantActions} />}
            </>
          )}
        </div>
      </div>

      <aside
        ref={asideRef}
        className="flex h-[80dvh] shrink-0 flex-col border-t border-border bg-panel lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0"
      >
        <div role="tablist" aria-label="Stream panels" className="flex shrink-0 border-b border-border">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} id="chat">
            Chat
          </TabButton>
          {isManager && (
            <>
              <TabButton active={tab === 'requests'} onClick={() => setTab('requests')} id="requests" badge={requestCount}>
                Requests
              </TabButton>
              <TabButton active={tab === 'moderation'} onClick={() => setTab('moderation')} id="moderation">
                Moderation
              </TabButton>
            </>
          )}
        </div>

        {tab === 'chat' && (
          <div role="tabpanel" id="panel-chat" className="flex min-h-0 flex-1 animate-fade-in flex-col">
            {chat.chatError && (
              <div className="px-4 pt-3">
                <ErrorBanner message={chat.chatError} onDismiss={chat.dismissChatError} />
              </div>
            )}
            <MessageList
              messages={chat.messages}
              currentUserId={selfId}
              loading={chat.loading}
              onAtBottomChange={chat.setAtBottom}
              messageActions={messageActions}
            />
            {!isLive ? (
              <ChatNotice icon={<Info size={14} />}>This stream has ended. Chat is read-only.</ChatNotice>
            ) : chat.muted ? (
              <ChatNotice icon={<ShieldAlert size={14} />} tone="warning">
                The host muted you. You can read chat but can't send messages.
              </ChatNotice>
            ) : (
              <MessageComposer
                onSend={chat.send}
                accessToken={token ?? ''}
                placeholder="Message the room"
                rateLimitedUntil={chat.rateLimitedUntil}
              />
            )}
          </div>
        )}

        {tab === 'requests' && isManager && (
          <div role="tabpanel" id="panel-requests" className="min-h-0 flex-1 animate-fade-in overflow-y-auto">
            {isLive ? (
              <SpeakRequestQueue requests={media.pendingRequests} onApprove={media.approveRequest} onDeny={media.denyRequest} />
            ) : (
              <p className="px-4 py-8 text-center text-sm text-text-muted">The stream has ended.</p>
            )}
          </div>
        )}

        {tab === 'moderation' && isManager && (
          <div role="tabpanel" id="panel-moderation" className="flex min-h-0 flex-1 animate-fade-in flex-col">
            <ModerationPanel
              users={modUsers}
              loading={modLoading}
              error={modError}
              onRefresh={refreshModeration}
              onAction={openAction}
            />
          </div>
        )}
      </aside>

      <RemoteAudioSink peers={media.remoteAudio} />

      {dialog && (
        <ModerationDialog
          action={dialog.action}
          target={dialog.target}
          warnings={modMap.get(dialog.target.userId)?.warnings ?? 0}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => runAction(dialog.action, dialog.target, reason)}
        />
      )}

      {warning && (
        <WarningModal
          warnings={warning.warnings}
          max={warning.max}
          reason={warning.reason}
          onClose={() => setWarning(null)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  id,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  id: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={onClick}
      className={cx(
        'relative flex-1 px-3 py-3 text-sm font-medium transition-colors',
        active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {children}
      {!!badge && badge > 0 && (
        <span
          key={badge}
          className="ml-1.5 inline-flex min-w-[18px] animate-badge-pop items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white"
        >
          {badge}
        </span>
      )}
      {active && <span className="absolute inset-x-3 bottom-0 h-0.5 animate-pop-in rounded-full bg-accent" />}
    </button>
  );
}

function ChatNotice({
  icon,
  tone = 'default',
  children,
}: {
  icon: ReactNode;
  tone?: 'default' | 'warning';
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex items-center gap-2 border-t border-border px-4 py-3 text-sm',
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-panel text-text-secondary'
      )}
      role="status"
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
