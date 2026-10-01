import { io, Socket } from 'socket.io-client';
import type {
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatErrorPayload,
} from '@streaming/shared-types';

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL ?? '/';
const CHAT_WS_PATH = import.meta.env.VITE_CHAT_WS_PATH ?? '/socket.io';

export interface ChatCallbacks {
  onHistory: (payload: ChatHistoryPayload) => void;
  onMessage: (payload: ChatMessagePayload) => void;
  onError?: (payload: ChatErrorPayload) => void;
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

  return socket;
}

export function joinChannel(socket: Socket, channelId: string) {
  socket.emit('chat:join', { channelId });
}

export function leaveChannel(socket: Socket, channelId: string) {
  socket.emit('chat:leave', { channelId });
}

export function sendMessage(socket: Socket, channelId: string, content: string) {
  socket.emit('chat:send', { channelId, content });
}
