import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { verifyAccessToken } from '@streaming/auth-shared';
import { publishEvent, consumeEvents, subscribeStreamEvents } from '@streaming/events';
import { STREAM_MAX_WARNINGS } from '@streaming/shared-types';
import type {
  ChatJoinPayload,
  ChatSendPayload,
  ChatDeletePayload,
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatMessageDeletedPayload,
  ChatErrorPayload,
  ChatErrorCode,
  AccessTokenClaims,
  StreamEvent,
  StreamWarningPayload,
  StreamMutedPayload,
  StreamRemovedPayload,
  StreamEndedPayload,
  ChannelAccess,
} from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { insertMessage, getRecentMessages, getLiveMessageAuthor, softDeleteMessage } from './db';
import { redisPub, redisConsume, redisSub, CHAT_STREAM, CHAT_CONSUMER_GROUP } from './redis';
import { lookupAccess } from './access';

interface AuthedSocket extends Socket {
  user?: AccessTokenClaims;
  /** Per-channel authorization state, populated on join/send (see ensureState). */
  chan?: Map<string, ChannelState>;
}

interface ChannelState {
  isStream: boolean;
  status?: 'live' | 'ended';
  isHost: boolean;
  isAdmin: boolean;
  banned: boolean;
  muted: boolean;
  warnings: number;
  checkedAt: number;
}

/** Stream states are re-verified against api-service at most this often on send/delete. */
const STATE_TTL_MS = 10_000;

const CHAT_MESSAGE_EVENT = 'chat.message';
const CHAT_MESSAGE_DELETED_EVENT = 'chat.message-deleted';

const uuid = z.string().uuid();

function roomName(channelId: string): string {
  return `channel:${channelId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function emitError(socket: Socket, code: ChatErrorCode, message: string, channelId?: string) {
  socket.emit('chat:error', { message, code, ...(channelId ? { channelId } : {}) } satisfies ChatErrorPayload);
}

function stateFromAccess(access: ChannelAccess): ChannelState {
  return {
    isStream: access.isStream,
    status: access.status,
    isHost: access.isHost,
    isAdmin: access.isAdmin,
    banned: access.banned,
    muted: access.muted,
    warnings: access.warnings,
    checkedAt: Date.now(),
  };
}

function plainState(): ChannelState {
  return { isStream: false, isHost: false, isAdmin: false, banned: false, muted: false, warnings: 0, checkedAt: Date.now() };
}

type EnsureResult = { ok: true; state: ChannelState } | { ok: false; code: ChatErrorCode; message: string };

/**
 * Returns the socket's authorization state for a channel, consulting
 * api-service (authoritative) when there is none yet, when `force` is set, or
 * when a stream's cached state is older than STATE_TTL_MS.
 *
 * - Plain (non-stream) channels: once known, cached forever; if the lookup
 *   fails they behave exactly as before this feature (no dependency on the
 *   new endpoint).
 * - Streams: fail closed on first lookup; on a *refresh* failure keep serving
 *   the previous state so a brief api-service blip doesn't break live chat.
 */
async function ensureState(
  socket: AuthedSocket,
  channelId: string,
  opts: { force?: boolean } = {}
): Promise<EnsureResult> {
  const cache = (socket.chan ??= new Map());
  const cached = cache.get(channelId);
  if (cached && !cached.isStream) return { ok: true, state: cached };
  if (cached && !opts.force && Date.now() - cached.checkedAt < STATE_TTL_MS) return { ok: true, state: cached };

  const user = socket.user!;
  const lookup = await lookupAccess(channelId, user.sub, user.email);

  if (lookup.status === 'ok') {
    const state = stateFromAccess(lookup.access);
    cache.set(channelId, state);
    return { ok: true, state };
  }
  if (lookup.status === 'not_found') {
    const state = plainState();
    cache.set(channelId, state);
    return { ok: true, state };
  }
  // unreachable
  if (lookup.isStream === false) {
    const state = plainState();
    cache.set(channelId, state);
    return { ok: true, state };
  }
  if (cached) return { ok: true, state: cached }; // known stream, refresh failed: keep last state
  return {
    ok: false,
    code: 'access_unavailable',
    message: 'Could not verify your access to this stream right now. Please try again.',
  };
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  /** Local sockets per user (this instance only; every instance receives every stream event). */
  const socketsByUser = new Map<string, Set<AuthedSocket>>();

  io.use((socket: AuthedSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);
    if (!token) {
      return next(new Error('missing_token'));
    }
    try {
      socket.user = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      return next();
    } catch {
      return next(new Error('invalid_token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    const user = socket.user!;
    logger.info({ userId: user.sub }, 'socket connected');
    socket.chan = new Map();

    // Personal room: lets us target warnings / removals at a user's sockets.
    void socket.join(userRoom(user.sub));
    let mine = socketsByUser.get(user.sub);
    if (!mine) socketsByUser.set(user.sub, (mine = new Set()));
    mine.add(socket);

    socket.on('chat:join', async (payload: ChatJoinPayload) => {
      try {
        if (!payload?.channelId) {
          emitError(socket, 'invalid_input', 'channelId required');
          return;
        }
        if (!uuid.safeParse(payload.channelId).success) {
          emitError(socket, 'invalid_input', 'channelId must be a valid UUID', payload.channelId);
          return;
        }
        const ensured = await ensureState(socket, payload.channelId, { force: true });
        if (!ensured.ok) {
          emitError(socket, ensured.code, ensured.message, payload.channelId);
          return;
        }
        if (ensured.state.banned) {
          logger.info({ userId: user.sub, channelId: payload.channelId }, 'banned user denied chat join');
          emitError(socket, 'banned', 'You are banned from this stream.', payload.channelId);
          return;
        }
        await socket.join(roomName(payload.channelId));
        const messages = await getRecentMessages(payload.channelId, 50);
        const history: ChatHistoryPayload = { channelId: payload.channelId, messages };
        socket.emit('chat:history', history);
      } catch (err) {
        logger.error({ err, channelId: payload?.channelId }, 'chat:join failed');
        emitError(socket, 'internal_error', 'failed to join channel', payload?.channelId);
      }
    });

    socket.on('chat:leave', async (payload: ChatJoinPayload) => {
      if (payload?.channelId) {
        await socket.leave(roomName(payload.channelId));
        socket.chan?.delete(payload.channelId);
      }
    });

    socket.on('chat:send', async (payload: ChatSendPayload) => {
      try {
        const trimmedContent = payload?.content?.trim() ?? '';
        // A message needs text OR an attachment — an image-only message
        // with no caption is a normal case once uploads exist.
        if (!payload?.channelId || (!trimmedContent && !payload.attachment)) {
          emitError(socket, 'invalid_input', 'channelId and content or attachment required');
          return;
        }
        if (trimmedContent.length > 2000) {
          emitError(socket, 'invalid_input', 'message too long', payload.channelId);
          return;
        }

        const ensured = await ensureState(socket, payload.channelId);
        if (!ensured.ok) {
          emitError(socket, ensured.code, ensured.message, payload.channelId);
          return;
        }
        const { state } = ensured;
        if (state.banned) {
          emitError(socket, 'banned', 'You are banned from this stream.', payload.channelId);
          return;
        }
        if (state.muted) {
          emitError(socket, 'muted', 'You are muted by the host and cannot send messages.', payload.channelId);
          return;
        }
        if (state.isStream && state.status === 'ended') {
          emitError(socket, 'stream_ended', 'This stream has ended.', payload.channelId);
          return;
        }

        const message = await insertMessage({
          channelId: payload.channelId,
          userId: user.sub,
          username: user.username,
          content: trimmedContent,
          attachment: payload.attachment,
        });

        // Fan out via Redis Streams rather than emitting directly, so that
        // multiple chat-service instances would all broadcast consistently.
        await publishEvent(redisPub, CHAT_STREAM, CHAT_MESSAGE_EVENT, {
          channelId: payload.channelId,
          message,
        } satisfies ChatMessagePayload);
      } catch (err) {
        logger.error({ err, channelId: payload?.channelId }, 'chat:send failed');
        emitError(socket, 'internal_error', 'failed to send message', payload?.channelId);
      }
    });

    socket.on('chat:delete', async (payload: ChatDeletePayload) => {
      try {
        if (
          !payload ||
          !uuid.safeParse(payload.channelId).success ||
          !uuid.safeParse(payload.messageId).success
        ) {
          emitError(socket, 'invalid_input', 'channelId and messageId must be valid UUIDs', payload?.channelId);
          return;
        }
        const message = await getLiveMessageAuthor(payload.channelId, payload.messageId);
        if (!message) {
          emitError(socket, 'not_found', 'Message not found.', payload.channelId);
          return;
        }

        let allowed = message.userId === user.sub; // authors can always delete their own
        if (!allowed) {
          // Moderator path: verify host/admin authoritatively (fresh lookup).
          const ensured = await ensureState(socket, payload.channelId, { force: true });
          if (!ensured.ok) {
            emitError(socket, ensured.code, ensured.message, payload.channelId);
            return;
          }
          allowed = ensured.state.isStream && (ensured.state.isHost || ensured.state.isAdmin);
        }
        if (!allowed) {
          logger.warn({ userId: user.sub, channelId: payload.channelId, messageId: payload.messageId }, 'chat:delete forbidden');
          emitError(socket, 'forbidden', 'You cannot delete this message.', payload.channelId);
          return;
        }

        const deleted = await softDeleteMessage(payload.channelId, payload.messageId, user.sub);
        if (!deleted) {
          emitError(socket, 'not_found', 'Message not found.', payload.channelId);
          return;
        }
        logger.info({ userId: user.sub, channelId: payload.channelId, messageId: payload.messageId }, 'message deleted');
        // Same fan-out mechanism as chat messages -> multi-instance-correct.
        await publishEvent(redisPub, CHAT_STREAM, CHAT_MESSAGE_DELETED_EVENT, {
          channelId: payload.channelId,
          messageId: payload.messageId,
        } satisfies ChatMessageDeletedPayload);
      } catch (err) {
        logger.error({ err, channelId: payload?.channelId }, 'chat:delete failed');
        emitError(socket, 'internal_error', 'failed to delete message', payload?.channelId);
      }
    });

    socket.on('disconnect', () => {
      logger.info({ userId: user.sub }, 'socket disconnected');
      const set = socketsByUser.get(user.sub);
      set?.delete(socket);
      if (set && set.size === 0) socketsByUser.delete(user.sub);
    });
  });

  // Consume the fan-out stream and broadcast to the relevant room. This is
  // what lets any chat-service instance see messages published by any other.
  const abortController = new AbortController();
  consumeEvents<ChatMessagePayload | ChatMessageDeletedPayload>(
    redisConsume,
    CHAT_STREAM,
    CHAT_CONSUMER_GROUP,
    (event) => {
      if (event.envelope.type === CHAT_MESSAGE_DELETED_EVENT) {
        const { channelId, messageId } = event.envelope.data as ChatMessageDeletedPayload;
        io.to(roomName(channelId)).emit('chat:message-deleted', { channelId, messageId } satisfies ChatMessageDeletedPayload);
        return;
      }
      const { channelId, message } = event.envelope.data as ChatMessagePayload;
      io.to(roomName(channelId)).emit('chat:message', { channelId, message } satisfies ChatMessagePayload);
    },
    { signal: abortController.signal }
  ).catch((err) => {
    logger.error({ err }, 'chat stream consumer loop crashed');
  });

  // Stream moderation / lifecycle events (pub/sub: every instance sees every
  // event). Best-effort acceleration only; chat:join / chat:send re-verify
  // against api-service, so a missed event never lets a banned user in.
  redisSub.on('error', (err) => logger.error({ err }, 'redis subscriber error'));
  subscribeStreamEvents(redisSub, (event: StreamEvent) => {
    if (event.type === 'stream-ended') {
      for (const set of socketsByUser.values()) {
        for (const s of set) {
          const st = s.chan?.get(event.streamId);
          if (st) st.status = 'ended';
        }
      }
      io.to(roomName(event.streamId)).emit('stream:ended', { streamId: event.streamId } satisfies StreamEndedPayload);
      return;
    }

    if (event.type === 'moderation') {
      const { streamId, targetUserId, action, reason } = event;
      const targets = socketsByUser.get(targetUserId);
      if (targets) {
        for (const s of targets) {
          const st = s.chan?.get(streamId);
          if (st) {
            if (action === 'warn') st.warnings = event.warnings ?? st.warnings + 1;
            else if (action === 'mute') st.muted = true;
            else if (action === 'unmute') st.muted = false;
            else if (action === 'ban') st.banned = true;
            else if (action === 'unban') st.banned = false;
          }
          if (action === 'kick' || action === 'ban') {
            void s.leave(roomName(streamId));
            if (action === 'kick') s.chan?.delete(streamId);
          }
        }
      }

      const target = io.to(userRoom(targetUserId));
      switch (action) {
        case 'warn':
          target.emit('stream:warning', {
            streamId,
            warnings: event.warnings ?? 1,
            max: STREAM_MAX_WARNINGS,
            ...(reason ? { reason } : {}),
          } satisfies StreamWarningPayload);
          break;
        case 'mute':
        case 'unmute':
          target.emit('stream:muted', { streamId, muted: action === 'mute' } satisfies StreamMutedPayload);
          break;
        case 'kick':
        case 'ban':
          target.emit('stream:removed', {
            streamId,
            action,
            ...(reason ? { reason } : {}),
          } satisfies StreamRemovedPayload);
          break;
        default:
          break; // 'unban': nothing to push; user re-joins and the join check passes
      }
    }
  });

  io.on('close', () => abortController.abort());

  return io;
}
