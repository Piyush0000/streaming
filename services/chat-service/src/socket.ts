import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '@streaming/auth-shared';
import { publishEvent, consumeEvents } from '@streaming/events';
import type {
  ChatJoinPayload,
  ChatSendPayload,
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatErrorPayload,
  AccessTokenClaims,
} from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { insertMessage, getRecentMessages } from './db';
import { redisPub, redisConsume, CHAT_STREAM, CHAT_CONSUMER_GROUP } from './redis';

interface AuthedSocket extends Socket {
  user?: AccessTokenClaims;
}

function roomName(channelId: string): string {
  return `channel:${channelId}`;
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

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
    logger.info({ userId: socket.user?.sub }, 'socket connected');

    socket.on('chat:join', async (payload: ChatJoinPayload) => {
      try {
        if (!payload?.channelId) {
          socket.emit('chat:error', { message: 'channelId required' } satisfies ChatErrorPayload);
          return;
        }
        await socket.join(roomName(payload.channelId));
        const messages = await getRecentMessages(payload.channelId, 50);
        const history: ChatHistoryPayload = { channelId: payload.channelId, messages };
        socket.emit('chat:history', history);
      } catch (err) {
        logger.error({ err }, 'chat:join failed');
        socket.emit('chat:error', { message: 'failed to join channel' } satisfies ChatErrorPayload);
      }
    });

    socket.on('chat:leave', async (payload: ChatJoinPayload) => {
      if (payload?.channelId) {
        await socket.leave(roomName(payload.channelId));
      }
    });

    socket.on('chat:send', async (payload: ChatSendPayload) => {
      try {
        const trimmedContent = payload?.content?.trim() ?? '';
        // A message needs text OR an attachment — an image-only message
        // with no caption is a normal case once uploads exist.
        if (!payload?.channelId || (!trimmedContent && !payload.attachment)) {
          socket.emit('chat:error', { message: 'channelId and content or attachment required' } satisfies ChatErrorPayload);
          return;
        }
        if (trimmedContent.length > 2000) {
          socket.emit('chat:error', { message: 'message too long' } satisfies ChatErrorPayload);
          return;
        }
        const user = socket.user!;
        const message = await insertMessage({
          channelId: payload.channelId,
          userId: user.sub,
          username: user.username,
          content: trimmedContent,
          attachment: payload.attachment,
        });

        // Fan out via Redis Streams rather than emitting directly, so that
        // multiple chat-service instances would all broadcast consistently.
        await publishEvent(redisPub, CHAT_STREAM, 'chat.message', {
          channelId: payload.channelId,
          message,
        } satisfies ChatMessagePayload);
      } catch (err) {
        logger.error({ err }, 'chat:send failed');
        socket.emit('chat:error', { message: 'failed to send message' } satisfies ChatErrorPayload);
      }
    });

    socket.on('disconnect', () => {
      logger.info({ userId: socket.user?.sub }, 'socket disconnected');
    });
  });

  // Consume the fan-out stream and broadcast to the relevant room. This is
  // what lets any chat-service instance see messages published by any other.
  const abortController = new AbortController();
  consumeEvents<ChatMessagePayload>(
    redisConsume,
    CHAT_STREAM,
    CHAT_CONSUMER_GROUP,
    (event) => {
      const { channelId, message } = event.envelope.data;
      io.to(roomName(channelId)).emit('chat:message', { channelId, message } satisfies ChatMessagePayload);
    },
    { signal: abortController.signal }
  ).catch((err) => {
    logger.error({ err }, 'chat stream consumer loop crashed');
  });

  io.on('close', () => abortController.abort());

  return io;
}
