import { io, Socket } from 'socket.io-client';
import type {
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatMessageDeletedPayload,
  ChatErrorPayload,
  MessageAttachment,
  StreamWarningPayload,
  StreamMutedPayload,
  StreamRemovedPayload,
  StreamEndedPayload,
} from '@streaming/shared-types';

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL ?? '/';
const CHAT_WS_PATH = import.meta.env.VITE_CHAT_WS_PATH ?? '/socket.io';

export interface ChatCallbacks {
  onHistory: (payload: ChatHistoryPayload) => void;
  onMessage: (payload: ChatMessagePayload) => void;
  onError?: (payload: ChatErrorPayload) => void;
  // Stream-only (all optional; plain text channels ignore them).
  onMessageDeleted?: (payload: ChatMessageDeletedPayload) => void;
  onStreamWarning?: (payload: StreamWarningPayload) => void;
  onStreamMuted?: (payload: StreamMutedPayload) => void;
  onStreamRemoved?: (payload: StreamRemovedPayload) => void;
  onStreamEnded?: (payload: StreamEndedPayload) => void;
}

export function connectChat(accessToken: string, callbacks: ChatCallbacks): Socket {
  const socket = io(CHAT_WS_URL, {
    path: CHAT_WS_PATH,
    auth: { token: accessToken },
    transports: ['websocket'],
  });

  socket.on('chat:history', callbacks.onHistory);
  socket.on('chat:message', callbacks.onMessage);
  socket.on('chat:error', (payload: ChatErrorPayload) => callbacks.onError?.(payload));
  socket.on('connect_error', (err) => callbacks.onError?.({ message: err.message }));

  if (callbacks.onMessageDeleted) socket.on('chat:message-deleted', callbacks.onMessageDeleted);
  if (callbacks.onStreamWarning) socket.on('stream:warning', callbacks.onStreamWarning);
  if (callbacks.onStreamMuted) socket.on('stream:muted', callbacks.onStreamMuted);
  if (callbacks.onStreamRemoved) socket.on('stream:removed', callbacks.onStreamRemoved);
  if (callbacks.onStreamEnded) socket.on('stream:ended', callbacks.onStreamEnded);

  return socket;
}

export function joinChannel(socket: Socket, channelId: string) {
  socket.emit('chat:join', { channelId });
}

export function leaveChannel(socket: Socket, channelId: string) {
  socket.emit('chat:leave', { channelId });
}

export function sendMessage(
  socket: Socket,
  channelId: string,
  content: string,
  attachment?: MessageAttachment | null
) {
  socket.emit('chat:send', { channelId, content, attachment });
}

/** Author, or the stream's host/admin, may delete; the server re-checks. */
export function deleteMessage(socket: Socket, channelId: string, messageId: string) {
  socket.emit('chat:delete', { channelId, messageId });
}
