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
  ChannelEvent,
  ChannelRemovedPayload,
  ChannelRemovedReason,
  ChannelRole,
  ChannelVisibility,
} from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { insertMessage, getRecentMessages, getBlockerIds, getLiveMessageAuthor, softDeleteMessage, purgeChannelMessages } from './db';
import { checkChatRateLimit } from './rateLimit';
import { redisPub, redisConsume, redisSub, CHAT_STREAM, CHAT_CONSUMER_GROUP } from './redis';
import { lookupAccess } from './access';

interface AuthedSocket extends Socket {
  user?: AccessTokenClaims;
  /** Per-channel authorization state, populated on join/send (see ensureState). */
  chan?: Map<string, ChannelState>;
}

interface ChannelState {
  canAccess: boolean;
  visibility: ChannelVisibility;
  myRole: ChannelRole | null;
  isStream: boolean;
  status?: 'live' | 'ended';
  isHost: boolean;
  isAdmin: boolean;
  banned: boolean;
  muted: boolean;
  warnings: number;
  checkedAt: number;
}

/** Stream + private-channel states are re-verified against api-service at most this often on send/delete. */
const STATE_TTL_MS = 10_000;
/** Public plain channels change rarely; re-verify lazily (events handle visibility flips immediately). */
const PUBLIC_STATE_TTL_MS = 60_000;
/** Safety net against a lost pub/sub event: periodically re-verify every private-channel membership we hold. */
const PRIVATE_SWEEP_INTERVAL_MS = 60_000;

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
    canAccess: access.canAccess ?? true,
    visibility: access.visibility ?? 'public',
    myRole: access.myRole ?? null,
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
  return {
    canAccess: true,
    visibility: 'public',
    myRole: null,
    isStream: false,
    isHost: false,
    isAdmin: false,
    banned: false,
    muted: false,
    warnings: 0,
    checkedAt: Date.now(),
  };
}

const NO_ACCESS_MESSAGE = 'You do not have access to this channel.';

const REMOVED_MESSAGES: Record<ChannelRemovedReason, string> = {
  removed: 'You were removed from this channel.',
  left: 'You left this channel.',
  deleted: 'This channel was deleted.',
  made_private: 'This channel is now private and you are not a member.',
};

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
  if (cached && !opts.force) {
    const ttl = cached.isStream || cached.visibility === 'private' ? STATE_TTL_MS : PUBLIC_STATE_TTL_MS;
    if (Date.now() - cached.checkedAt < ttl) return { ok: true, state: cached };
  }

  const user = socket.user!;
  const lookup = await lookupAccess(channelId, user.sub, user.email);

  if (lookup.status === 'ok') {
    const state = stateFromAccess(lookup.access);
    cache.set(channelId, state);
    return { ok: true, state };
  }
  if (lookup.status === 'not_found') {
    // Deleted / unknown channel. Same answer as "private and not yours" so existence never leaks.
    cache.delete(channelId);
    return { ok: false, code: 'not_member', message: NO_ACCESS_MESSAGE };
  }
  // unreachable
  if (cached) return { ok: true, state: cached }; // refresh failed: keep the last known state
  if (!lookup.failClosed) {
    const state = plainState(); // public plain channel: same behaviour as before this feature
    cache.set(channelId, state);
    return { ok: true, state };
  }
  return {
    ok: false,
    code: 'access_unavailable',
    message: 'Could not verify your access to this channel right now. Please try again.',
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
        if (!ensured.state.canAccess) {
          logger.info({ userId: user.sub, channelId: payload.channelId }, 'non-member denied chat join');
          emitError(socket, 'not_member', NO_ACCESS_MESSAGE, payload.channelId);
          return;
        }
        if (ensured.state.banned) {
          logger.info({ userId: user.sub, channelId: payload.channelId }, 'banned user denied chat join');
          emitError(socket, 'banned', 'You are banned from this stream.', payload.channelId);
          return;
        }
        await socket.join(roomName(payload.channelId));
        const messages = await getRecentMessages(payload.channelId, 50, user.sub);
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
        if (!state.canAccess) {
          emitError(socket, 'not_member', NO_ACCESS_MESSAGE, payload.channelId);
          return;
        }
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

        // Per-user rate limit (Redis counter; fails open with an error log if Redis is down).
        const rl = await checkChatRateLimit(user.sub);
        if (!rl.allowed) {
          const secs = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
          socket.emit('chat:error', {
            message: `You are sending messages too fast. Try again in ${secs}s.`,
            code: 'rate_limited',
            channelId: payload.channelId,
            retryAfterMs: rl.retryAfterMs,
          } satisfies ChatErrorPayload);
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

        const isAuthor = message.userId === user.sub;
        // Authors may delete their own messages, but only while they still have access to the channel.
        // Moderator path (not author) always uses a fresh lookup so role changes apply immediately.
        const ensured = await ensureState(socket, payload.channelId, { force: !isAuthor });
        // An author whose access cannot be verified right now (api-service down) keeps today's behaviour.
        const authorBlip = isAuthor && !ensured.ok && ensured.code === 'access_unavailable';
        if (!ensured.ok && !authorBlip) {
          emitError(socket, ensured.code, ensured.message, payload.channelId);
          return;
        }
        if (ensured.ok && !ensured.state.canAccess) {
          emitError(socket, 'not_member', NO_ACCESS_MESSAGE, payload.channelId);
          return;
        }
        const st = ensured.ok ? ensured.state : undefined;
        // Streams: host / platform admin. Plain channels: channel owner / mod.
        const allowed =
          isAuthor ||
          (!!st && (st.isStream ? st.isHost || st.isAdmin : st.myRole === 'owner' || st.myRole === 'mod'));
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
    async (event) => {
      if (event.envelope.type === CHAT_MESSAGE_DELETED_EVENT) {
        const { channelId, messageId } = event.envelope.data as ChatMessageDeletedPayload;
        io.to(roomName(channelId)).emit('chat:message-deleted', { channelId, messageId } satisfies ChatMessageDeletedPayload);
        return;
      }
      const { channelId, message } = event.envelope.data as ChatMessagePayload;
      // Per-recipient block filtering: skip the personal rooms of everyone who blocked the author.
      // Never reveals itself to the author; getBlockerIds never throws (clients filter too).
      const blockers = await getBlockerIds(message.userId);
      const target = blockers.length > 0 ? io.to(roomName(channelId)).except(blockers.map(userRoom)) : io.to(roomName(channelId));
      target.emit('chat:message', { channelId, message } satisfies ChatMessagePayload);
    },
    { signal: abortController.signal }
  ).catch((err) => {
    logger.error({ err }, 'chat stream consumer loop crashed');
  });

  // --- Channel membership / lifecycle enforcement (private channels) --------

  /** Takes every local socket of `userId` out of `channelId`'s room and tells the user once. */
  function ejectUser(userId: string, channelId: string, reason: ChannelRemovedReason) {
    const sockets = socketsByUser.get(userId);
    if (!sockets) return;
    for (const s of sockets) {
      void s.leave(roomName(channelId));
      s.chan?.delete(channelId);
    }
    io.to(userRoom(userId)).emit('channel:removed', {
      channelId,
      reason,
      message: REMOVED_MESSAGES[reason],
    } satisfies ChannelRemovedPayload);
    logger.info({ userId, channelId, reason }, 'user ejected from channel');
  }

  /** Does this socket currently hold the channel (joined its room or cached state for it)? */
  function holdsChannel(s: AuthedSocket, channelId: string): boolean {
    return s.rooms.has(roomName(channelId)) || !!s.chan?.has(channelId);
  }

  /** Authoritatively re-checks a user's access; eject (and report) if they lost it. Unreachable api -> eject (fail closed). */
  async function reverifyUser(userId: string, channelId: string, reason: ChannelRemovedReason) {
    const sockets = socketsByUser.get(userId);
    const first = sockets && sockets.values().next().value;
    if (!first) return;
    first.chan?.delete(channelId);
    const lookup = await lookupAccess(channelId, userId, first.user!.email);
    if (lookup.status === 'ok' && lookup.access.canAccess) {
      // Still allowed (e.g. the channel is public): just drop stale cached roles on every socket.
      for (const s of socketsByUser.get(userId) ?? []) s.chan?.delete(channelId);
      return;
    }
    if (lookup.status === 'unreachable' && !lookup.failClosed) return; // public plain channel + api down
    ejectUser(userId, channelId, reason);
  }

  async function handleChannelEvent(event: ChannelEvent) {
    if (event.type === 'channel-member-removed') {
      await reverifyUser(event.userId, event.channelId, event.reason ?? 'removed');
      return;
    }
    if (event.type === 'channel-deleted') {
      try {
        const n = await purgeChannelMessages(event.channelId);
        logger.info({ channelId: event.channelId, purged: n }, 'purged messages of deleted channel');
      } catch (err) {
        logger.error({ err, channelId: event.channelId }, 'failed to purge messages of deleted channel');
      }
      for (const [userId, set] of Array.from(socketsByUser.entries())) {
        if (Array.from(set).some((s) => holdsChannel(s, event.channelId))) {
          ejectUser(userId, event.channelId, 'deleted');
        }
      }
      return;
    }
    if (event.type === 'channel-visibility-changed') {
      const affected: string[] = [];
      for (const [userId, set] of socketsByUser.entries()) {
        if (Array.from(set).some((s) => holdsChannel(s, event.channelId))) affected.push(userId);
      }
      for (const userId of affected) await reverifyUser(userId, event.channelId, 'made_private');
    }
  }

  // Safety net for a lost pub/sub message: periodically re-verify private-channel memberships we hold.
  let sweeping = false;
  const sweepTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const pairs = new Map<string, { userId: string; channelId: string }>();
      for (const [userId, set] of socketsByUser.entries()) {
        for (const s of set) {
          for (const [channelId, st] of s.chan ?? []) {
            if (st.visibility === 'private') pairs.set(`${userId}:${channelId}`, { userId, channelId });
          }
        }
      }
      for (const { userId, channelId } of pairs.values()) {
        const first = socketsByUser.get(userId)?.values().next().value;
        if (!first) continue;
        const lookup = await lookupAccess(channelId, userId, first.user!.email);
        if (lookup.status === 'not_found' || (lookup.status === 'ok' && !lookup.access.canAccess)) {
          ejectUser(userId, channelId, lookup.status === 'not_found' ? 'deleted' : 'removed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'private channel sweep failed');
    } finally {
      sweeping = false;
    }
  }, PRIVATE_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  // Stream moderation / lifecycle events (pub/sub: every instance sees every
  // event). Best-effort acceleration only; chat:join / chat:send re-verify
  // against api-service, so a missed event never lets a banned user in.
  redisSub.on('error', (err) => logger.error({ err }, 'redis subscriber error'));
  subscribeStreamEvents(redisSub, async (event: StreamEvent) => {
    if (
      event.type === 'channel-member-removed' ||
      event.type === 'channel-deleted' ||
      event.type === 'channel-visibility-changed'
    ) {
      await handleChannelEvent(event);
      return;
    }
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

  io.on('close', () => {
    abortController.abort();
    clearInterval(sweepTimer);
  });

  return io;
}
