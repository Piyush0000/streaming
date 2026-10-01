import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type { Channel, Message } from '@streaming/shared-types';
import { Hash, Volume2 } from 'lucide-react';
import { connectChat, joinChannel, leaveChannel, sendMessage } from '../lib/chat';
import { VoiceClient, RemotePeerAudio } from '../lib/media';
import { listChannels } from '../lib/api';
import { useSession } from '../context/SessionContext';
import MessageList from '../components/MessageList';
import MessageComposer from '../components/MessageComposer';
import VoicePanel, { VoiceState } from '../components/VoicePanel';
import ErrorBanner from '../components/ErrorBanner';

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

  function handleSend(content: string) {
    if (!socketRef.current || !channelId) return;
    sendMessage(socketRef.current, channelId, content);
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
        onPeerLeft: (peerId) => {
          setRemotePeers((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
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
    setMuted(false);
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

        <MessageList messages={messages} currentUserId={session?.user.id ?? ''} loading={messagesLoading} />

        <MessageComposer
          onSend={handleSend}
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
      />
    </div>
  );
}
