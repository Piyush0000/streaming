import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type { Channel, Message, MessageAttachment } from '@streaming/shared-types';
import { Hash, Volume2 } from 'lucide-react';
import { connectChat, joinChannel, leaveChannel, sendMessage } from '../lib/chat';
import { VoiceClient, RemotePeerAudio, RemotePeerVideo } from '../lib/media';
import { listChannels } from '../lib/api';
import { useSession } from '../context/SessionContext';
import { playJoinSound, playLeaveSound, playMessageSound } from '../lib/sounds';
import MessageList from '../components/MessageList';
import MessageComposer from '../components/MessageComposer';
import VoicePanel, { VoiceState } from '../components/VoicePanel';
import ErrorBanner from '../components/ErrorBanner';

const screenShareSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export default function ChannelPage() {
  const { session, logout } = useSession();
  const { channelId } = useParams<{ channelId: string }>();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerAudio>>(new Map());
  const voiceClientRef = useRef<VoiceClient | null>(null);

  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenShares, setRemoteScreenShares] = useState<Map<string, RemotePeerVideo>>(new Map());

  // Tracked outside React state (read inside socket callbacks that close over
  // stale state otherwise) so the message-sound gate always sees the latest
  // "am I looking at the bottom of this channel" answer.
  const isAtBottomRef = useRef(true);

  // Look up the channel's own metadata (name/topic/kind) for the header.
  useEffect(() => {
    let cancelled = false;
    if (!session || !channelId) return;
    setChannelsLoading(true);
    listChannels(session.accessToken)
      .then((list) => {
        if (cancelled) return;
        setChannel(list.find((c) => c.id === channelId) ?? null);
      })
      .catch(() => {
        /* header is cosmetic — chat below still works even if this fails */
      })
      .finally(() => !cancelled && setChannelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, channelId]);

  // Chat connection — one socket per channel visited.
  useEffect(() => {
    if (!session || !channelId) return;
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
      onError: (payload) => {
        setChatError(payload.message);
        setMessagesLoading(false);
        if (payload.message.toLowerCase().includes('token')) logout();
      },
    });
    socketRef.current = socket;
    socket.on('connect', () => joinChannel(socket, channelId));

    return () => {
      leaveChannel(socket, channelId);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, channelId]);

  // Leave voice automatically when navigating away from the channel entirely.
  useEffect(() => {
    return () => {
      voiceClientRef.current?.leave();
      voiceClientRef.current = null;
    };
  }, [channelId]);

  function handleSend(content: string, attachment?: MessageAttachment | null) {
    if (!socketRef.current || !channelId) return;
    sendMessage(socketRef.current, channelId, content, attachment);
  }

  async function handleJoinVoice() {
    if (!session || !channelId) return;
    setVoiceError(null);
    setVoiceState('connecting');
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
        onPeerJoined: () => {
          playJoinSound();
        },
        onPeerLeft: (peerId) => {
          setRemotePeers((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
          playLeaveSound();
        },
        onError: (message) => setVoiceError(message),
      });
      voiceClientRef.current = client;
      await client.joinAndPublish(channelId);
      setMuted(false);
      setVoiceState('connected');
    } catch (err) {
      setVoiceError((err as Error).message);
      setVoiceState('error');
    }
  }

  async function handleLeaveVoice() {
    await voiceClientRef.current?.leave();
    voiceClientRef.current = null;
    setVoiceState('idle');
    setRemotePeers(new Map());
    setRemoteScreenShares(new Map());
    setLocalScreenStream(null);
    setIsSharingScreen(false);
    setMuted(false);
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
      // the promise — that's a normal cancel, not an error worth surfacing.
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

  if (!channelId) return null;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          {channel?.kind === 'voice' ? (
            <Volume2 size={18} className="text-text-muted" />
          ) : (
            <Hash size={18} className="text-text-muted" />
          )}
          <h1 className="truncate text-sm font-semibold text-text-primary">
            {channelsLoading ? 'Loading…' : channel?.name ?? 'Channel'}
          </h1>
          {channel?.topic && (
            <>
              <span className="text-text-muted">·</span>
              <p className="truncate text-sm text-text-secondary">{channel.topic}</p>
            </>
          )}
        </div>

        {chatError && (
          <div className="px-4 pt-3">
            <ErrorBanner message={chatError} onDismiss={() => setChatError(null)} />
          </div>
        )}

        {(localScreenStream || remoteScreenShares.size > 0) && (
          <div className="flex flex-wrap gap-3 border-b border-border bg-base px-4 py-3">
            {localScreenStream && (
              <div className="relative overflow-hidden rounded-lg border border-border bg-black">
                <video
                  ref={(el) => {
                    if (el && el.srcObject !== localScreenStream) {
                      el.srcObject = localScreenStream;
                    }
                  }}
                  autoPlay
                  muted
                  playsInline
                  className="h-40 w-auto max-w-full"
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                  You (sharing)
                </span>
              </div>
            )}
            {Array.from(remoteScreenShares.values()).map((peer) => (
              <div key={peer.peerId} className="relative overflow-hidden rounded-lg border border-border bg-black">
                <video
                  ref={(el) => {
                    if (el && el.srcObject !== peer.stream) {
                      el.srcObject = peer.stream;
                    }
                  }}
                  autoPlay
                  playsInline
                  className="h-40 w-auto max-w-full"
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                  {peer.username}
                </span>
              </div>
            ))}
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
        />
      </div>

      <VoicePanel
        voiceState={voiceState}
        voiceError={voiceError}
        onDismissError={() => setVoiceError(null)}
        remotePeers={Array.from(remotePeers.values())}
        selfUsername={session?.user.username ?? ''}
        muted={muted}
        onJoin={handleJoinVoice}
        onLeave={handleLeaveVoice}
        onToggleMute={handleToggleMute}
        screenShareSupported={screenShareSupported}
        isSharingScreen={isSharingScreen}
        onStartScreenShare={handleStartScreenShare}
        onStopScreenShare={handleStopScreenShare}
      />
    </div>
  );
}
