import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type { Channel, Message, MessageAttachment } from '@streaming/shared-types';
import { Hash, Lock, Users, Volume2 } from 'lucide-react';
import { connectChat, joinChannel, leaveChannel, sendMessage } from '../lib/chat';
import {
  VoiceClient,
  RemotePeerAudio,
  RemotePeerVideo,
  describeMediaJoinError,
} from '../lib/media';
import { getChannel, isChannelGone } from '../lib/channels';
import { useSession } from '../context/SessionContext';
import { classifyJoinFailure, OFFLINE_MESSAGE, SESSION_EXPIRED_MESSAGE } from '../lib/errorMessages';
import { sessionManager } from '../lib/sessionManager';
import { backoffDelayMs } from '../lib/reconnect';
import { useChannels } from '../context/ChannelsContext';
import { useToast } from '../context/ToastContext';
import { useJoinToasts } from '../hooks/useJoinToasts';
import { useChannelRemoved } from '../hooks/useChannelRemoved';
import { playJoinSound, playLeaveSound, playMessageSound } from '../lib/sounds';
import MessageList from '../components/MessageList';
import MessageComposer from '../components/MessageComposer';
import VoicePanel, { VoiceState } from '../components/VoicePanel';
import ErrorBanner from '../components/ErrorBanner';
import AccessDenied from '../components/AccessDenied';
import ChannelSettingsModal from '../components/ChannelSettingsModal';
import ParticipantGrid from '../components/ParticipantGrid';
import AnimatedBackground from '../components/AnimatedBackground';
import CallControls from '../components/CallControls';
import type { TileModel } from '../components/ParticipantTile';
import { useProfiles } from '../hooks/useProfiles';

const screenShareSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export default function ChannelPage() {
  const { session } = useSession();
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const { refresh: refreshChannels } = useChannels();
  const { showToast } = useToast();
  const peerNames = useRef<Map<string, string>>(new Map());
  const joinToasts = useJoinToasts(showToast, 'the call');
  const { handleChannelRemoved, markSelfInitiated } = useChannelRemoved();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(true);
  /** Private/deleted/unknown channel: GET 404 or a `not_member` chat error. */
  const [denied, setDenied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatReconnecting, setChatReconnecting] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerAudio>>(new Map());
  const voiceClientRef = useRef<VoiceClient | null>(null);

  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenShares, setRemoteScreenShares] = useState<Map<string, RemotePeerVideo>>(new Map());

  /** peerId -> userId, so tiles can show profile pictures. */
  const [peerUserIds, setPeerUserIds] = useState<Map<string, string>>(new Map());

  // Tracked outside React state (read inside socket callbacks that close over
  // stale state otherwise) so the message-sound gate always sees the latest
  // "am I looking at the bottom of this channel" answer.
  const isAtBottomRef = useRef(true);

  // Look up the channel's own metadata (name/topic/kind/role) for the header.
  const loadChannel = useCallback(async () => {
    if (!session || !channelId) return;
    try {
      const ch = await getChannel(session.accessToken, channelId);
      setChannel(ch);
      setDenied(false);
    } catch (err) {
      if (isChannelGone(err)) setDenied(true);
      /* anything else: header is cosmetic - chat below still works */
    }
  }, [session, channelId]);

  useEffect(() => {
    setChannel(null);
    setDenied(false);
    setSettingsOpen(false);
    setRateLimitedUntil(null);
    setChannelsLoading(true);
    let cancelled = false;
    loadChannel().finally(() => !cancelled && setChannelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadChannel]);

  // Chat connection - one socket per channel visited.
  useEffect(() => {
    if (!session || !channelId || denied) return;
    setMessages([]);
    setMessagesLoading(true);
    setChatError(null);

    const socket = connectChat(session.accessToken, {
      onHistory: (payload) => {
        if (payload.channelId === channelId) {
          setMessages(payload.messages);
          setMessagesLoading(false);
        }
      },
      onMessage: (payload) => {
        if (payload.channelId === channelId) {
          setMessages((prev) => [...prev, payload.message]);
          const isOwnMessage = payload.message.userId === session.user.id;
          const isLookingAtIt = document.hasFocus() && isAtBottomRef.current;
          if (!isOwnMessage && !isLookingAtIt) {
            playMessageSound();
          }
        }
      },
      onConnectionState: (state) => {
        setChatReconnecting(state === 'reconnecting');
        if (state === 'connected') setChatError(null);
      },
      onError: (payload) => {
        if (payload.code === 'not_member' && (!payload.channelId || payload.channelId === channelId)) {
          setMessagesLoading(false);
          setDenied(true);
          return;
        }
        if (payload.code === 'rate_limited') {
          setRateLimitedUntil(Date.now() + (payload.retryAfterMs ?? 3000));
          return;
        }
        // Auth problems are handled by the session manager (refresh, or one friendly sign-out); never show raw codes.
        setChatError(/token/i.test(payload.message) ? SESSION_EXPIRED_MESSAGE : payload.message);
        setMessagesLoading(false);
      },
      onChannelRemoved: (payload) => {
        handleChannelRemoved(payload, { current: payload.channelId === channelId, fallbackPath: '/channels' });
      },
    });
    socketRef.current = socket;
    socket.on('connect', () => joinChannel(socket, channelId));

    return () => {
      leaveChannel(socket, channelId);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, channelId, denied]);

  // Leave voice automatically when navigating away from the channel entirely.
  useEffect(() => {
    return () => {
      voiceClientRef.current?.leave();
      voiceClientRef.current = null;
    };
  }, [channelId]);

  const profileIds = useMemo(
    () => [session?.user.id, ...peerUserIds.values()].filter((id): id is string => !!id),
    [session?.user.id, peerUserIds]
  );
  const profiles = useProfiles(profileIds);
  const selfMicStream = voiceState === 'connected' ? voiceClientRef.current?.micStream ?? null : null;
  const selfProfile = session ? profiles.get(session.user.id) : undefined;
  const selfUsername = session?.user.username;

  const tiles = useMemo<TileModel[]>(() => {
    if (voiceState !== 'connected') return [];
    const list: TileModel[] = [
      {
        id: 'self',
        name: selfProfile?.displayName || selfUsername || 'You',
        avatarUrl: selfProfile?.avatarUrl ?? null,
        avatarPreset: selfProfile?.avatarPreset ?? null,
        audioStream: selfMicStream,
        isSelf: true,
        micMuted: muted,
      },
    ];
    for (const peer of remotePeers.values()) {
      const profile = profiles.get(peerUserIds.get(peer.peerId) ?? '');
      list.push({
        id: peer.peerId,
        name: profile?.displayName || peer.username,
        avatarUrl: profile?.avatarUrl ?? null,
        avatarPreset: profile?.avatarPreset ?? null,
        audioStream: peer.stream,
      });
    }
    return list;
  }, [voiceState, selfProfile, selfUsername, selfMicStream, muted, remotePeers, profiles, peerUserIds]);

  const screenTiles = useMemo<TileModel[]>(() => {
    const list: TileModel[] = [];
    if (localScreenStream) {
      list.push({ id: 'screen:local', name: 'You', videoStream: localScreenStream, isScreen: true, isSelf: true });
    }
    for (const peer of remoteScreenShares.values()) {
      list.push({ id: `screen:${peer.peerId}`, name: peer.username, videoStream: peer.stream, isScreen: true });
    }
    return list;
  }, [localScreenStream, remoteScreenShares]);

  const presetByPeerId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [peerId, userId] of peerUserIds) map.set(peerId, profiles.get(userId)?.avatarPreset ?? null);
    return map;
  }, [peerUserIds, profiles]);

  const avatarByPeerId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [peerId, userId] of peerUserIds) map.set(peerId, profiles.get(userId)?.avatarUrl ?? null);
    return map;
  }, [peerUserIds, profiles]);

  function handleSend(content: string, attachment?: MessageAttachment | null) {
    if (!socketRef.current || !channelId) return;
    sendMessage(socketRef.current, channelId, content, attachment);
  }

  function resetVoiceUi() {
    setVoiceState('idle');
    setRemotePeers(new Map());
    setRemoteScreenShares(new Map());
    setLocalScreenStream(null);
    setIsSharingScreen(false);
    setPeerUserIds(new Map());
    setMuted(false);
  }

  const rejoinsRef = useRef<number[]>([]);

  /** One join attempt. Resolves to null on success, or the error (state cleaned up) so the caller can classify / retry. */
  async function joinVoiceAttempt(): Promise<unknown> {
    if (!session || !channelId) return null;
    try {
      const client = await VoiceClient.connect(session.accessToken, {
        onRemoteStream: (peer) => {
          setRemotePeers((prev) => new Map(prev).set(peer.peerId, peer));
        },
        onRemoteScreenShare: (peer) => {
          setRemoteScreenShares((prev) => new Map(prev).set(peer.peerId, peer));
        },
        onRemoteScreenShareEnded: (peerId) => {
          setRemoteScreenShares((prev) => {
            if (!prev.has(peerId)) return prev;
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        },
        onPeerJoined: (peerId, username, info) => {
          if (info?.userId) setPeerUserIds((prev) => new Map(prev).set(peerId, info.userId));
          peerNames.current.set(peerId, username);
          joinToasts.peerJoined(username);
          playJoinSound();
        },
        onPeerLeft: (peerId) => {
          const goneName = peerNames.current.get(peerId);
          peerNames.current.delete(peerId);
          if (goneName) joinToasts.peerLeft(goneName);
          setRemotePeers((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
          setPeerUserIds((prev) => {
            if (!prev.has(peerId)) return prev;
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
          playLeaveSound();
        },
        onError: (message) => setVoiceError(message),
        // The server dropped us (removed from the channel, kicked, channel deleted / made private).
        onRemoved: (reason) => {
          const gone = voiceClientRef.current;
          voiceClientRef.current = null;
          void gone?.leave();
          resetVoiceUi();
          setVoiceError(reason || 'You were removed from the voice room.');
        },
        onDisconnected: () => {
          voiceClientRef.current = null;
          resetVoiceUi();
          // Rejoin automatically (network switch / brief outage); give up after 3 drops in 30s.
          const now = Date.now();
          rejoinsRef.current = rejoinsRef.current.filter((t) => now - t < 30_000);
          if (rejoinsRef.current.length < 3) {
            rejoinsRef.current.push(now);
            setVoiceError(OFFLINE_MESSAGE);
            void handleJoinVoice();
          } else {
            setVoiceError('Lost the connection to the voice room. Press Join to reconnect.');
          }
        },
      });
      voiceClientRef.current = client;
      const existing = await client.joinAndPublish(channelId);
      setPeerUserIds(new Map(existing.map((p) => [p.peerId, p.userId])));
      setMuted(false);
      setVoiceState('connected');
      return null;
    } catch (err) {
      // Release the half-open signaling socket (e.g. after room_full / forbidden).
      const failed = voiceClientRef.current;
      voiceClientRef.current = null;
      void failed?.leave();
      return err;
    }
  }

  async function handleJoinVoice() {
    if (!session || !channelId || voiceState === 'connecting') return;
    setVoiceError(null);
    setVoiceState('connecting');
    let authRetried = false;
    for (let n = 0; ; n++) {
      const err = await joinVoiceAttempt();
      if (err === null) return;
      const failure = classifyJoinFailure(err);
      if (failure.kind === 'auth' && !authRetried) {
        authRetried = true;
        await sessionManager.refreshNow({ staleAccessToken: sessionManager.getAccessToken() });
        continue;
      }
      if (failure.kind === 'transient' && n < 3) {
        setVoiceError(OFFLINE_MESSAGE);
        await new Promise((r) => setTimeout(r, backoffDelayMs(n + 1)));
        setVoiceError(null);
        continue;
      }
      setVoiceError(describeMediaJoinError(err));
      setVoiceState('error');
      return;
    }
  }

  async function handleLeaveVoice() {
    const client = voiceClientRef.current;
    voiceClientRef.current = null;
    await client?.leave();
    resetVoiceUi();
  }

  async function handleStartScreenShare() {
    if (!voiceClientRef.current) return;
    try {
      const stream = await voiceClientRef.current.startScreenShare();
      setLocalScreenStream(stream);
      setIsSharingScreen(true);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsSharingScreen(false);
        setLocalScreenStream(null);
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      // The user cancelling the browser's own screen-picker dialog rejects
      // the promise - that's a normal cancel, not an error worth surfacing.
      if (name === 'NotAllowedError' || name === 'AbortError') return;
      setVoiceError((err as Error).message);
    }
  }

  async function handleStopScreenShare() {
    await voiceClientRef.current?.stopScreenShare();
    setIsSharingScreen(false);
    setLocalScreenStream(null);
  }

  function handleToggleMute() {
    const next = !muted;
    voiceClientRef.current?.setMicMuted(next);
    setMuted(next);
  }

  // ---- channel settings callbacks ----------------------------------------

  function afterLeaveOrDelete(message: string) {
    if (channelId) markSelfInitiated(channelId);
    setSettingsOpen(false);
    showToast(message, 'success');
    void refreshChannels();
    navigate('/channels', { replace: true });
  }

  if (!channelId) return null;

  if (denied) return <AccessDenied />;

  const canOpenSettings = !!channel && channel.kind !== 'stream';

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:contents">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 max-md:order-[-2]">
          {channel?.kind === 'voice' ? (
            <Volume2 size={18} className="shrink-0 text-text-muted" />
          ) : (
            <Hash size={18} className="shrink-0 text-text-muted" />
          )}
          <h1 className="truncate text-sm font-semibold text-text-primary">
            {channelsLoading ? 'Loading…' : channel?.name ?? 'Channel'}
          </h1>
          {channel?.visibility === 'private' && (
            <span className="flex shrink-0 items-center gap-1 text-text-muted" title="Private channel">
              <Lock size={13} aria-hidden />
              <span className="sr-only">Private channel</span>
            </span>
          )}
          {channel?.topic && (
            <>
              <span className="hidden text-text-muted sm:inline">·</span>
              <p className="hidden min-w-0 truncate text-sm text-text-secondary sm:block">{channel.topic}</p>
            </>
          )}
          {canOpenSettings && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="tap ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="Channel members and settings"
              aria-haspopup="dialog"
              title="Members & settings"
            >
              <Users size={16} aria-hidden />
              <span className="hidden sm:inline">Members</span>
            </button>
          )}
        </div>

        {chatReconnecting && !chatError && (
          <p role="status" className="px-4 pt-2 text-xs text-text-muted">
            Reconnecting to chat…
          </p>
        )}

        {chatError && (
          <div className="px-4 pt-3">
            <ErrorBanner message={chatError} onDismiss={() => setChatError(null)} />
          </div>
        )}

        {voiceState === 'connected' && (
          <div className="relative flex max-h-[45dvh] shrink-0 md:max-h-[62dvh] animate-slide-down flex-col gap-3 overflow-y-auto border-b border-border bg-base px-3 py-3 sm:px-4">
            <AnimatedBackground variant="grid-pulse" subtle />
            <div className="relative z-10 flex flex-col gap-3">
            <ParticipantGrid tiles={tiles} screens={screenTiles} />
            <CallControls
              micState="live"
              muted={muted}
              onToggleMute={handleToggleMute}
              screenSupported={screenShareSupported}
              isSharingScreen={isSharingScreen}
              onStartScreenShare={handleStartScreenShare}
              onStopScreenShare={handleStopScreenShare}
              onLeave={handleLeaveVoice}
            />
            </div>
          </div>
        )}

        <MessageList
          messages={messages}
          currentUserId={session?.user.id ?? ''}
          loading={messagesLoading}
          onAtBottomChange={(atBottom) => {
            isAtBottomRef.current = atBottom;
          }}
        />

        <MessageComposer
          onSend={handleSend}
          accessToken={session?.accessToken ?? ''}
          placeholder={channel ? `Message #${channel.name}` : 'Say something...'}
          rateLimitedUntil={rateLimitedUntil}
        />
      </div>

      <VoicePanel
        voiceState={voiceState}
        voiceError={voiceError}
        onDismissError={() => setVoiceError(null)}
        remotePeers={Array.from(remotePeers.values())}
        selfUsername={session?.user.username ?? ''}
        selfAvatarUrl={selfProfile?.avatarUrl ?? null}
        avatarByPeerId={avatarByPeerId}
        selfAvatarPreset={selfProfile?.avatarPreset ?? null}
        presetByPeerId={presetByPeerId}
        selfStream={selfMicStream}
        muted={muted}
        onJoin={handleJoinVoice}
        maxParticipants={channel?.effectiveMaxParticipants}
      />

      {settingsOpen && channel && (
        <ChannelSettingsModal
          channel={channel}
          onClose={() => setSettingsOpen(false)}
          onMembersChanged={() => {
            void loadChannel();
            void refreshChannels();
          }}
          onUpdated={(updated) => {
            setChannel(updated);
            void refreshChannels();
          }}
          onLeft={() => afterLeaveOrDelete(`You left #${channel.name}.`)}
          onDeleted={() => afterLeaveOrDelete(`#${channel.name} was deleted.`)}
        />
      )}
    </div>
  );
}
