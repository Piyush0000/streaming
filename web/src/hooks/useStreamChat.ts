import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  ChannelRemovedPayload,
  Message,
  MessageAttachment,
  StreamRemovedPayload,
  StreamWarningPayload,
} from '@streaming/shared-types';
import { connectChat, deleteMessage, joinChannel, leaveChannel, sendMessage } from '../lib/chat';
import { playMessageSound } from '../lib/sounds';

export interface StreamChatEvents {
  onWarning: (payload: StreamWarningPayload) => void;
  onRemoved: (payload: StreamRemovedPayload) => void;
  onEnded: () => void;
  onAuthError: () => void;
  /** The server took us out of a channel (arrives for any channel, not only this stream). */
  onChannelRemoved: (payload: ChannelRemovedPayload) => void;
  /** Chat says we may no longer see this room. */
  onAccessDenied: () => void;
}

/** Chat socket for one stream: history, live messages, deletions, mute state and moderation pushes. */
export function useStreamChat({
  streamId,
  token,
  selfUserId,
  enabled,
  initialMuted,
  events,
}: {
  streamId: string | undefined;
  token: string | undefined;
  selfUserId: string | undefined;
  enabled: boolean;
  initialMuted: boolean;
  events: StreamChatEvents;
}) {
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const hasToken = !!token;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const socketRef = useRef<Socket | null>(null);
  const isAtBottomRef = useRef(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [muted, setMuted] = useState(initialMuted);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  useEffect(() => {
    setMuted(initialMuted);
  }, [initialMuted, streamId]);

  useEffect(() => {
    if (!enabled || !hasToken || !streamId) return;
    setMessages([]);
    setLoading(true);
    setChatError(null);

    const socket = connectChat(tokenRef.current ?? '', {
      onConnectionState: (state) => {
        setReconnecting(state === 'reconnecting');
        if (state === 'connected') setChatError(null);
      },
      onHistory: (payload) => {
        if (payload.channelId !== streamId) return;
        setMessages(payload.messages);
        setLoading(false);
      },
      onMessage: (payload) => {
        if (payload.channelId !== streamId) return;
        setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
        const own = payload.message.userId === selfUserId;
        if (!own && !(document.hasFocus() && isAtBottomRef.current)) playMessageSound();
      },
      onMessageDeleted: ({ channelId, messageId }) => {
        if (channelId !== streamId) return;
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      },
      onError: (payload) => {
        setLoading(false);
        if (payload.message.toLowerCase().includes('token')) {
          eventsRef.current.onAuthError();
          return;
        }
        switch (payload.code) {
          case 'rate_limited':
            setRateLimitedUntil(Date.now() + (payload.retryAfterMs ?? 3000));
            return;
          case 'not_member':
            eventsRef.current.onAccessDenied();
            return;
          case 'muted':
            setMuted(true);
            return;
          case 'stream_ended':
            eventsRef.current.onEnded();
            return;
          case 'banned':
            eventsRef.current.onRemoved({ streamId, action: 'ban' });
            return;
          default:
            setChatError(payload.message);
        }
      },
      onChannelRemoved: (payload) => eventsRef.current.onChannelRemoved(payload),
      onStreamWarning: (payload) => {
        if (payload.streamId === streamId) eventsRef.current.onWarning(payload);
      },
      onStreamMuted: (payload) => {
        if (payload.streamId === streamId) setMuted(payload.muted);
      },
      onStreamRemoved: (payload) => {
        if (payload.streamId === streamId) eventsRef.current.onRemoved(payload);
      },
      onStreamEnded: (payload) => {
        if (payload.streamId === streamId) eventsRef.current.onEnded();
      },
    });
    socketRef.current = socket;
    socket.on('connect', () => joinChannel(socket, streamId));

    return () => {
      leaveChannel(socket, streamId);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
    // The token is read through tokenRef (and the socket's auth callback), so a token refresh must NOT tear the socket down.
  }, [enabled, hasToken, streamId, selfUserId]);

  const send = useCallback(
    (content: string, attachment?: MessageAttachment | null) => {
      if (socketRef.current && streamId) sendMessage(socketRef.current, streamId, content, attachment);
    },
    [streamId]
  );

  const remove = useCallback(
    (messageId: string) => {
      if (socketRef.current && streamId) deleteMessage(socketRef.current, streamId, messageId);
    },
    [streamId]
  );

  return {
    messages,
    loading,
    chatError,
    reconnecting,
    dismissChatError: () => setChatError(null),
    muted,
    rateLimitedUntil,
    send,
    remove,
    setAtBottom: (atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
    },
  };
}
