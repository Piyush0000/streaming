import { io, Socket } from 'socket.io-client';
import { sessionManager } from './sessionManager';
import type {
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatMessageDeletedPayload,
  ChatErrorPayload,
  ChannelRemovedPayload,
  MessageAttachment,
  StreamWarningPayload,
  StreamMutedPayload,
  StreamRemovedPayload,
  StreamEndedPayload,
} from '@streaming/shared-types';

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL ?? '/';
const CHAT_WS_PATH = import.meta.env.VITE_CHAT_WS_PATH ?? '/socket.io';

export type ChatConnectionState = 'connected' | 'reconnecting';

export interface ChatCallbacks {
  /** Subtle connectivity status (for a small "Reconnecting…" hint); never an error. */
  onConnectionState?: (state: ChatConnectionState) => void;
  onHistory: (payload: ChatHistoryPayload) => void;
  onMessage: (payload: ChatMessagePayload) => void;
  onError?: (payload: ChatErrorPayload) => void;
  /** The server took us out of a channel (removed / left / deleted / made private). Arrives for any channel, not just the open one. */
  onChannelRemoved?: (payload: ChannelRemovedPayload) => void;
  // Stream-only (all optional; plain text channels ignore them).
  onMessageDeleted?: (payload: ChatMessageDeletedPayload) => void;
  onStreamWarning?: (payload: StreamWarningPayload) => void;
  onStreamMuted?: (payload: StreamMutedPayload) => void;
  onStreamRemoved?: (payload: StreamRemovedPayload) => void;
  onStreamEnded?: (payload: StreamEndedPayload) => void;
}

/**
 * Opens the chat socket. The token is supplied through an `auth` CALLBACK, so every
 * (re)connect handshake sends the LATEST access token (the one passed in is only a
 * fallback). A handshake rejected for a bad/expired token triggers ONE refresh and a
 * manual reconnect (socket.io does not auto-retry after a middleware rejection).
 * Transient connect errors are not surfaced as errors: socket.io keeps retrying.
 */
export function connectChat(accessToken: string, callbacks: ChatCallbacks): Socket {
  const socket = io(CHAT_WS_URL, {
    path: CHAT_WS_PATH,
    auth: (cb) => {
      void sessionManager
        .ensureFresh()
        .catch(() => null)
        .then((fresh) => cb({ token: fresh ?? sessionManager.getAccessToken() ?? accessToken }));
    },
    transports: ['websocket'],
    reconnectionDelayMax: 10_000,
  });

  let authRetries = 0;
  let failures = 0;
  socket.on('connect', () => {
    authRetries = 0;
    failures = 0;
    callbacks.onConnectionState?.('connected');
  });
  socket.on('disconnect', (reason) => {
    // A deliberate client disconnect (leaving the page) is not a connectivity problem.
    if (reason !== 'io client disconnect') callbacks.onConnectionState?.('reconnecting');
  });
  socket.on('chat:history', callbacks.onHistory);
  socket.on('chat:message', callbacks.onMessage);
  socket.on('chat:error', (payload: ChatErrorPayload) => callbacks.onError?.(payload));
  socket.on('connect_error', (err) => {
    const msg = String(err?.message ?? '');
    if (/token/i.test(msg)) {
      if (authRetries < 1) {
        authRetries += 1;
        callbacks.onConnectionState?.('reconnecting');
        void sessionManager
          .refreshNow({ staleAccessToken: sessionManager.getAccessToken() })
          .then((tok) => {
            if (tok) {
              if (!socket.active && !socket.connected) socket.connect();
            } else if (sessionManager.getSession()) {
              // Transient refresh failure: the session is intact, so try the handshake again shortly.
              authRetries = 0;
              setTimeout(() => {
                if (!socket.active && !socket.connected) socket.connect();
              }, 5000);
            }
            // else: the session was lost; SessionWatcher signs the user out with one friendly toast.
          });
        return;
      }
      callbacks.onError?.({ message: msg });
      return;
    }
    // Network blips: socket.io retries with backoff on its own. Only report after repeated failures.
    failures += 1;
    callbacks.onConnectionState?.('reconnecting');
    if (failures >= 6) callbacks.onError?.({ message: "Can't reach chat right now. Retrying…" });
  });

  if (callbacks.onChannelRemoved) socket.on('channel:removed', callbacks.onChannelRemoved);
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
