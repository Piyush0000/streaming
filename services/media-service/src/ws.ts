import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { URL } from 'url';
import { verifyAccessToken } from '@streaming/auth-shared';
import type {
  MediaRequest,
  MediaResponse,
  MediaNotification,
  JoinRoomPayload,
  JoinRoomResult,
  CreateWebRtcTransportPayload,
  CreateWebRtcTransportResult,
  ConnectWebRtcTransportPayload,
  ProducePayload,
  ProduceResult,
  ConsumePayload,
  ConsumeResult,
  CloseProducerPayload,
  NewProducerNotification,
  PeerJoinedNotification,
  PeerLeftNotification,
  ProducerClosedNotification,
  ProducerSource,
  PeerInfo,
  PeerRole,
  PeerTargetPayload,
  RoleChangedNotification,
  SpeakRequestedNotification,
  SpeakRequestResolvedNotification,
  RemovedNotification,
  StreamEndedNotification,
  StreamEvent,
  ChannelEvent,
  MediaErrorCode,
} from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { roomManager, Room, Peer, hasUser, uniqueUserCount } from './rooms';
import { redis, redisSub, PRESENCE_CHANNEL } from './redis';
import { publishPresence, subscribeStreamEvents } from '@streaming/events';
import { lookupAccess, knownPublicPlainChannel, knownMaxParticipants, endStreamViaApi } from './access';

interface Connection {
  ws: WebSocket;
  userId: string;
  username: string;
  email: string;
  peerId: string;
  room?: Room;
}

/** How long the host may be absent from a live stream room before the stream is ended. */
const HOST_ABSENT_TIMEOUT_MS = 2 * 60 * 1000;
const HOST_END_RETRY_MS = 15_000;
const HOST_END_MAX_ATTEMPTS = 4;

const NO_ACCESS_MESSAGE = 'You do not have access to this channel.';

/** A failed request carrying a stable machine-readable code (sent as `code` next to the readable `error`). */
class MediaError extends Error {
  constructor(
    public readonly code: MediaErrorCode,
    message: string,
    public readonly extra: { capacity?: { current: number; max: number }; retryAfterMs?: number } = {}
  ) {
    super(message);
  }
}

function send(ws: WebSocket, msg: MediaResponse | MediaNotification) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function ok<T>(id: string, payload?: T): MediaResponse<T> {
  return { id, ok: true, payload };
}

function fail(id: string, error: string): MediaResponse {
  return { id, ok: false, error };
}

/** The producer's `source` ('mic' | 'screen') is carried in its mediasoup appData. */
function producerSource(producer: { appData: Record<string, unknown> }): ProducerSource {
  return (producer.appData.source as ProducerSource | undefined) ?? 'mic';
}

/** Producers live per-peer; look one up (and its owning peer) by id across the room. */
function findProducer(room: Room, producerId: string) {
  for (const peer of room.peers.values()) {
    const producer = peer.producers.get(producerId);
    if (producer) return { producer, ownerPeerId: peer.id };
  }
  return undefined;
}

function peerInfo(p: Peer): PeerInfo {
  return {
    peerId: p.id,
    userId: p.userId,
    username: p.username,
    role: p.role,
    producers: Array.from(p.producers.values()).map((producer) => ({
      id: producer.id,
      kind: producer.kind,
      source: producerSource(producer),
    })),
  };
}

const connectionsByPeerId = new Map<string, Connection>();

function broadcastToRoom(room: Room, exceptPeerId: string | null, msg: MediaNotification) {
  for (const peer of room.peers.values()) {
    if (peer.id === exceptPeerId) continue;
    const conn = connectionsByPeerId.get(peer.id);
    if (conn) send(conn.ws, msg);
  }
}

function sendToPeer(room: Room, peerId: string, msg: MediaNotification) {
  if (!room.peers.has(peerId)) return;
  const conn = connectionsByPeerId.get(peerId);
  if (conn) send(conn.ws, msg);
}

/** Stream "managers": the host and any platform admin present in the room. */
function isManager(peer: Peer): boolean {
  return peer.role === 'host' || peer.isAdmin;
}

function notifyManagers(room: Room, msg: MediaNotification, exceptPeerId?: string) {
  for (const peer of room.peers.values()) {
    if (peer.id === exceptPeerId || !isManager(peer)) continue;
    const conn = connectionsByPeerId.get(peer.id);
    if (conn) send(conn.ws, msg);
  }
}

// ---------------------------------------------------------------------------
// Host-absent handling: lives outside Room because the room is destroyed when
// its last peer leaves, but the stream must still be ended 2 min later.
// ---------------------------------------------------------------------------

const hostAbsentTimers = new Map<string, NodeJS.Timeout>();

function cancelHostAbsentTimer(streamId: string) {
  const t = hostAbsentTimers.get(streamId);
  if (t) {
    clearTimeout(t);
    hostAbsentTimers.delete(streamId);
    logger.info({ streamId }, 'host-absent timer cancelled');
  }
}

function startHostAbsentTimer(streamId: string) {
  if (hostAbsentTimers.has(streamId)) return;
  logger.info({ streamId, timeoutMs: HOST_ABSENT_TIMEOUT_MS }, 'host left; starting host-absent timer');
  const attempt = (n: number) => {
    const t = setTimeout(async () => {
      hostAbsentTimers.delete(streamId);
      logger.warn({ streamId, attempt: n }, 'host did not return in time; ending stream');
      const done = await endStreamViaApi(streamId);
      // api-service may be briefly down: retry a few times. A host rejoin
      // (cancelHostAbsentTimer) or the stream-ended event stops the retries.
      if (!done && n < HOST_END_MAX_ATTEMPTS && !hostAbsentTimers.has(streamId)) attempt(n + 1);
    }, n === 1 ? HOST_ABSENT_TIMEOUT_MS : HOST_END_RETRY_MS);
    hostAbsentTimers.set(streamId, t);
  };
  attempt(1);
}

function hostStillPresent(room: Room): boolean {
  for (const p of room.peers.values()) if (p.role === 'host') return true;
  return false;
}

// ---------------------------------------------------------------------------

async function handleJoinRoom(conn: Connection, payload: JoinRoomPayload): Promise<JoinRoomResult> {
  const channelId = payload?.channelId;
  if (!channelId || typeof channelId !== 'string') throw new Error('channelId required');

  // Switching rooms on the same connection: leave the old one cleanly first.
  if (conn.room) leaveRoom(conn);

  // Authoritative access check (api-service). Public plain voice channels behave as before.
  const lookup = await lookupAccess(channelId, conn.userId, conn.email);
  let isStream = false;
  let access: Extract<typeof lookup, { status: 'ok' }>['access'] | undefined;
  if (lookup.status === 'ok') {
    access = lookup.access;
    isStream = access.isStream;
  } else if (lookup.status === 'not_found') {
    // Same answer as "private and not yours" so existence never leaks.
    throw new MediaError('forbidden', NO_ACCESS_MESSAGE);
  } else if (!knownPublicPlainChannel(channelId)) {
    // Can't tell stream / private from public plain voice: fail closed rather than let a banned or non-member user in.
    throw new MediaError(
      'access_unavailable',
      'Could not verify access to this room right now (access service unavailable). Please try again.'
    );
  }

  if (access && !access.canAccess) {
    logger.info({ userId: conn.userId, channelId }, 'non-member denied voice join');
    throw new MediaError('forbidden', NO_ACCESS_MESSAGE);
  }
  if (isStream && access) {
    if (access.status !== 'live') throw new MediaError('stream_ended', 'This stream has ended.');
    if (access.banned) throw new MediaError('banned', 'You are banned from this stream.');
  }

  const room = await roomManager.getOrCreateRoom(channelId, {
    isStream,
    hostId: access?.hostId,
    hostUsername: access?.hostUsername,
    title: access?.title,
  });

  if (conn.ws.readyState !== WebSocket.OPEN) {
    roomManager.closeIfEmpty(room);
    throw new Error('connection closed during join');
  }

  let role: PeerRole = 'speaker'; // plain voice channels: everyone talks, as before
  if (isStream && access) {
    role = access.isHost ? 'host' : room.speakerUserIds.has(conn.userId) ? 'speaker' : 'listener';
  }

  const peer: Peer = {
    id: conn.peerId,
    userId: conn.userId,
    username: conn.username,
    role,
    isAdmin: isStream && !!access?.isAdmin,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  // Capacity, by UNIQUE users (a second tab of someone already inside is not a new participant).
  // Checked synchronously with addPeer (no await in between) so concurrent joins cannot overshoot.
  // Stream hosts and platform admins are always let in.
  const bypassCapacity = isStream && !!access && (access.isHost || access.isAdmin);
  if (!bypassCapacity && !hasUser(room, conn.userId)) {
    const max = access?.maxParticipants ?? knownMaxParticipants(channelId) ?? env.VOICE_ROOM_MAX_PEERS;
    const current = uniqueUserCount(room);
    if (current >= max) {
      roomManager.closeIfEmpty(room);
      logger.info({ userId: conn.userId, channelId, current, max }, 'join rejected: room full');
      throw new MediaError('room_full', `This room is full (${current}/${max}).`, { capacity: { current, max } });
    }
  }

  const existingPeers = Array.from(room.peers.values()).map(peerInfo);

  roomManager.addPeer(room, peer);
  conn.room = room;
  if (isStream && role === 'host') cancelHostAbsentTimer(channelId);

  broadcastToRoom(room, conn.peerId, {
    notification: 'peer-joined',
    payload: {
      peerId: peer.id,
      userId: peer.userId,
      username: peer.username,
      role: peer.role,
    } satisfies PeerJoinedNotification,
  });

  publishPresence(redis, PRESENCE_CHANNEL, {
    channelId,
    peerId: peer.id,
    username: peer.username,
    event: 'joined',
  }).catch((err) => logger.warn({ err }, 'presence publish failed'));

  const pendingSpeakRequests =
    isStream && isManager(peer)
      ? Array.from(room.pendingSpeakRequests)
          .map((pid) => room.peers.get(pid))
          .filter((p): p is Peer => !!p)
          .map((p) => ({ peerId: p.id, userId: p.userId, username: p.username }))
      : [];

  return {
    routerRtpCapabilities: room.router.rtpCapabilities,
    peers: existingPeers,
    you: { peerId: peer.id, userId: peer.userId, role: peer.role, isAdmin: peer.isAdmin },
    ...(isStream && room.hostId
      ? { stream: { id: channelId, title: room.title ?? '', hostId: room.hostId, hostUsername: room.hostUsername ?? '' } }
      : {}),
    pendingSpeakRequests,
  };
}

function leaveRoom(conn: Connection) {
  if (!conn.room) return;
  const room = conn.room;
  const wasPending = room.pendingSpeakRequests.has(conn.peerId);
  roomManager.removePeer(room, conn.peerId);
  conn.room = undefined;

  broadcastToRoom(room, conn.peerId, {
    notification: 'peer-left',
    payload: { peerId: conn.peerId } satisfies PeerLeftNotification,
  });
  if (wasPending) {
    notifyManagers(room, {
      notification: 'speak-request-resolved',
      payload: { peerId: conn.peerId, approved: false, cancelled: true } satisfies SpeakRequestResolvedNotification,
    });
  }
  publishPresence(redis, PRESENCE_CHANNEL, {
    channelId: room.channelId,
    peerId: conn.peerId,
    username: conn.username,
    event: 'left',
  }).catch((err) => logger.warn({ err }, 'presence publish failed'));

  if (room.isStream && room.hostId === conn.userId && !hostStillPresent(room)) {
    startHostAbsentTimer(room.channelId);
  }
}

/** Tells a peer why it is being removed, drops it from its room, then closes its socket. */
function removeConnection(conn: Connection, reason: string) {
  const payload: RemovedNotification = { reason };
  send(conn.ws, { notification: 'removed', payload });
  leaveRoom(conn);
  conn.ws.close(4003, 'removed');
}

function requireStreamRoom(conn: Connection): { room: Room; peer: Peer } {
  const room = conn.room;
  const peer = room?.peers.get(conn.peerId);
  if (!room || !peer) throw new Error('not in a room');
  if (!room.isStream) throw new Error('not a stream room');
  return { room, peer };
}

function requireManager(conn: Connection): { room: Room; peer: Peer } {
  const ctx = requireStreamRoom(conn);
  if (!isManager(ctx.peer)) throw new Error('only the host or an admin can do that');
  return ctx;
}

function targetPeer(room: Room, payload: PeerTargetPayload): Peer {
  const target = payload?.peerId ? room.peers.get(payload.peerId) : undefined;
  if (!target) throw new Error('peer not found');
  return target;
}

/** Closes a peer's mic producer(s) (used when a speaker is demoted to listener). */
function closeSpeakerProducers(room: Room, target: Peer) {
  for (const producer of Array.from(target.producers.values())) {
    const src = producerSource(producer);
    if (src !== 'mic') continue;
    const producerId = producer.id;
    // Closing fires 'producerclose' on every consumer -> they get 'producer-closed'.
    producer.close();
    target.producers.delete(producerId);
    // The owner has no consumer for its own producer; tell it directly.
    sendToPeer(room, target.id, {
      notification: 'producer-closed',
      payload: { producerId, peerId: target.id } satisfies ProducerClosedNotification,
    });
  }
}

// ---------------------------------------------------------------------------
// Stream events from api-service (best-effort acceleration; join is authoritative)
// ---------------------------------------------------------------------------

/** Peers (connections) currently in a channel's room. */
function connectionsInChannel(channelId: string): Connection[] {
  return Array.from(connectionsByPeerId.values()).filter((c) => c.room?.channelId === channelId);
}

const CHANNEL_REMOVED_REASONS = {
  removed: 'You were removed from this channel.',
  left: 'You left this channel.',
  deleted: 'This channel was deleted.',
  made_private: 'This channel is now private and you are not a member.',
} as const;

/**
 * Private-channel enforcement. Best-effort acceleration like the stream
 * events: join always re-checks authoritatively. For member-removed /
 * visibility-changed we re-verify each affected user against api-service and
 * only remove those who really lost access (fail closed if it is unreachable).
 */
async function handleChannelEvent(event: ChannelEvent) {
  const conns = connectionsInChannel(event.channelId);
  if (conns.length === 0) return;

  if (event.type === 'channel-deleted') {
    for (const c of conns) removeConnection(c, CHANNEL_REMOVED_REASONS.deleted);
    return;
  }

  const byUser = new Map<string, Connection[]>();
  for (const c of conns) {
    if (event.type === 'channel-member-removed' && c.userId !== event.userId) continue;
    byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  }
  const reason =
    event.type === 'channel-member-removed'
      ? CHANNEL_REMOVED_REASONS[event.reason ?? 'removed']
      : CHANNEL_REMOVED_REASONS.made_private;
  for (const [userId, userConns] of byUser) {
    const lookup = await lookupAccess(event.channelId, userId, userConns[0].email);
    if (lookup.status === 'ok' && lookup.access.canAccess) continue;
    if (lookup.status === 'unreachable' && knownPublicPlainChannel(event.channelId)) continue;
    logger.info({ channelId: event.channelId, userId, event: event.type }, 'removing peer that lost channel access');
    for (const c of userConns) if (c.room?.channelId === event.channelId) removeConnection(c, reason);
  }
}

async function handleStreamEvent(event: StreamEvent) {
  if (
    event.type === 'channel-member-removed' ||
    event.type === 'channel-deleted' ||
    event.type === 'channel-visibility-changed'
  ) {
    await handleChannelEvent(event);
    return;
  }
  if (event.type === 'stream-ended') {
    cancelHostAbsentTimer(event.streamId);
    const room = roomManager.getRoom(event.streamId);
    if (!room) return;
    logger.info({ streamId: event.streamId }, 'stream ended; closing room');
    broadcastToRoom(room, null, {
      notification: 'stream-ended',
      payload: { streamId: event.streamId } satisfies StreamEndedNotification,
    });
    for (const peerId of Array.from(room.peers.keys())) {
      const c = connectionsByPeerId.get(peerId);
      if (c) c.room = undefined;
      roomManager.removePeer(room, peerId); // last removal closes the room
    }
    return;
  }

  if (event.type === 'moderation' && (event.action === 'kick' || event.action === 'ban')) {
    const reason =
      event.reason ??
      (event.action === 'ban' ? 'You were banned from this stream.' : 'You were removed from this stream.');
    for (const c of Array.from(connectionsByPeerId.values())) {
      if (c.userId === event.targetUserId && c.room?.channelId === event.streamId) {
        logger.info({ streamId: event.streamId, userId: c.userId, action: event.action }, 'removing moderated peer');
        removeConnection(c, reason);
      }
    }
  }
}

/** WebSocket ping cadence; a connection that misses one full cycle is terminated. */
const HEARTBEAT_MS = 25_000;

export function createMediaWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/media' });

  redisSub.on('error', (err) => logger.error({ err }, 'redis subscriber error'));
  subscribeStreamEvents(redisSub, handleStreamEvent);

  wss.on('connection', (ws, req) => {
    let conn: Connection;
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) throw new Error('missing token');
      const claims = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      conn = { ws, userId: claims.sub, username: claims.username, email: claims.email, peerId: uuidv4() };
      connectionsByPeerId.set(conn.peerId, conn);
      logger.info({ userId: conn.userId, peerId: conn.peerId }, 'media socket connected');
    } catch (err) {
      logger.warn({ err }, 'media socket auth failed');
      ws.close(4001, 'unauthorized');
      return;
    }

    // Keepalive: ping every HEARTBEAT_MS and terminate sockets that never answer (half-open
    // mobile / NAT connections), so ghost peers are removed promptly via the 'close' handler.
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        logger.info({ peerId: conn.peerId, userId: conn.userId }, 'media socket missed heartbeat; terminating');
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket already closing */
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    ws.on('message', async (raw) => {
      alive = true;
      let req: MediaRequest;
      try {
        req = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        switch (req.type) {
          case 'join-room': {
            const result = await handleJoinRoom(conn, req.payload as JoinRoomPayload);
            send(ws, ok(req.id, result));
            break;
          }

          case 'ping': {
            // Application-level keepalive: lets the browser (which cannot see WS ping frames) detect a dead link.
            send(ws, ok(req.id, { t: Date.now() }));
            break;
          }

          case 'get-router-rtp-capabilities': {
            if (!conn.room) throw new Error('not in a room');
            send(ws, ok(req.id, conn.room.router.rtpCapabilities));
            break;
          }

          case 'create-webrtc-transport': {
            if (!conn.room) throw new Error('not in a room');
            const peer = conn.room.peers.get(conn.peerId);
            if (!peer) throw new Error('peer not found');
            const transport = await roomManager.createWebRtcTransport(conn.room);
            peer.transports.set(transport.id, transport);
            const result: CreateWebRtcTransportResult = {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            };
            send(ws, ok(req.id, result));
            break;
          }

          case 'connect-webrtc-transport': {
            const { transportId, dtlsParameters } = req.payload as ConnectWebRtcTransportPayload;
            const peer = conn.room?.peers.get(conn.peerId);
            const transport = peer?.transports.get(transportId);
            if (!transport) throw new Error('transport not found');
            await transport.connect({ dtlsParameters: dtlsParameters as any });
            send(ws, ok(req.id));
            break;
          }

          case 'produce': {
            const { transportId, kind, rtpParameters, source } = req.payload as ProducePayload;
            const room = conn.room;
            const peer = room?.peers.get(conn.peerId);
            const transport = peer?.transports.get(transportId);
            if (!room || !peer || !transport) throw new Error('transport not found');

            if ((source as string) === 'camera') {
              throw new Error('Camera/video calls are not supported. Only microphone audio and host screen-share can be published.');
            }
            if (source !== 'mic' && source !== 'screen') {
              throw new Error(`invalid producer source: ${String(source)}`);
            }
            if (kind !== 'audio' && kind !== 'video') {
              throw new Error(`invalid producer kind: ${String(kind)}`);
            }
            if ((source === 'mic') !== (kind === 'audio')) {
              throw new Error('mic must be an audio producer; screen must be a video producer');
            }

            // Server-side role enforcement for stream rooms (plain voice
            // channels: everyone is a 'speaker', so nothing changes there).
            if (room.isStream) {
              if (source === 'mic' && peer.role !== 'host' && peer.role !== 'speaker') {
                throw new Error('Only the host and approved speakers can speak. Request to speak first.');
              }
              if (source === 'screen' && peer.role !== 'host') {
                throw new Error('Only the host can share their screen.');
              }
            }

            // One screen-share producer per peer at a time. If
            // they already have one (e.g. re-starting without the old one
            // tearing down cleanly), replace it rather than stacking producers.
            if (source === 'screen') {
              for (const existing of Array.from(peer.producers.values())) {
                if (producerSource(existing) === source) {
                  // Closing triggers each consumer's own 'producerclose' event
                  // (same in-process flow as the explicit close-producer
                  // request below), which notifies other peers — no need to
                  // broadcast again here.
                  existing.close();
                  peer.producers.delete(existing.id);
                }
              }
            }

            const producer = await transport.produce({
              kind,
              rtpParameters: rtpParameters as any,
              appData: { source },
            });
            peer.producers.set(producer.id, producer);

            producer.on('transportclose', () => {
              peer.producers.delete(producer.id);
            });

            broadcastToRoom(room, conn.peerId, {
              notification: 'new-producer',
              payload: {
                peerId: conn.peerId,
                username: conn.username,
                producerId: producer.id,
                kind: producer.kind,
                source: producerSource(producer),
              } satisfies NewProducerNotification,
            });

            const result: ProduceResult = { id: producer.id };
            send(ws, ok(req.id, result));
            break;
          }

          case 'consume': {
            const { transportId, producerId, rtpCapabilities } = req.payload as ConsumePayload;
            const room = conn.room;
            const peer = room?.peers.get(conn.peerId);
            const transport = peer?.transports.get(transportId);
            if (!room || !peer || !transport) throw new Error('transport not found');

            const found = findProducer(room, producerId);
            if (!found) throw new Error('producer not found');
            const { producer: sourceProducer, ownerPeerId } = found;

            if (!room.router.canConsume({ producerId, rtpCapabilities: rtpCapabilities as any })) {
              throw new Error('cannot consume this producer with given rtpCapabilities');
            }

            const consumer = await transport.consume({
              producerId,
              rtpCapabilities: rtpCapabilities as any,
              paused: true,
            });
            peer.consumers.set(consumer.id, consumer);

            consumer.on('producerclose', () => {
              peer.consumers.delete(consumer.id);
              send(ws, {
                notification: 'producer-closed',
                payload: { producerId, peerId: ownerPeerId } satisfies ProducerClosedNotification,
              });
            });

            const result: ConsumeResult = {
              id: consumer.id,
              producerId,
              kind: consumer.kind,
              source: producerSource(sourceProducer),
              rtpParameters: consumer.rtpParameters,
            };
            send(ws, ok(req.id, result));
            break;
          }

          case 'resume-consumer': {
            const { consumerId } = req.payload as { consumerId: string };
            const peer = conn.room?.peers.get(conn.peerId);
            const consumer = peer?.consumers.get(consumerId);
            if (!consumer) throw new Error('consumer not found');
            await consumer.resume();
            send(ws, ok(req.id));
            break;
          }

          case 'close-producer': {
            const { producerId } = req.payload as CloseProducerPayload;
            const peer = conn.room?.peers.get(conn.peerId);
            const producer = peer?.producers.get(producerId);
            if (!peer || !producer) throw new Error('producer not found');
            // Closing fires 'producerclose' on every consumer of this producer
            // (in-process, same flow as peer-leave), which notifies the rest
            // of the room — nothing else to broadcast from here.
            producer.close();
            peer.producers.delete(producerId);
            send(ws, ok(req.id));
            break;
          }

          case 'leave-room': {
            leaveRoom(conn);
            send(ws, ok(req.id));
            break;
          }

          // --- Stream speaker management -----------------------------------

          case 'request-speak': {
            const { room, peer } = requireStreamRoom(conn);
            if (peer.role !== 'listener') throw new Error('only listeners can request to speak');
            const cooldownUntil = room.speakCooldownUntil.get(peer.userId) ?? 0;
            if (cooldownUntil > Date.now()) {
              const retryAfterMs = cooldownUntil - Date.now();
              throw new MediaError(
                'speak_cooldown',
                `Your last request was declined. You can ask to speak again in ${Math.ceil(retryAfterMs / 1000)}s.`,
                { retryAfterMs }
              );
            }
            // At most one pending request per user (a second tab cannot stack another).
            if (!room.pendingSpeakRequests.has(peer.id)) {
              for (const pid of room.pendingSpeakRequests) {
                if (room.peers.get(pid)?.userId === peer.userId) {
                  throw new MediaError('speak_request_pending', 'You already have a pending request to speak.');
                }
              }
            }
            if (!room.pendingSpeakRequests.has(peer.id)) {
              room.pendingSpeakRequests.add(peer.id);
              notifyManagers(room, {
                notification: 'speak-requested',
                payload: {
                  peerId: peer.id,
                  userId: peer.userId,
                  username: peer.username,
                } satisfies SpeakRequestedNotification,
              });
            }
            send(ws, ok(req.id));
            break;
          }

          case 'cancel-speak-request': {
            const { room, peer } = requireStreamRoom(conn);
            if (room.pendingSpeakRequests.delete(peer.id)) {
              notifyManagers(room, {
                notification: 'speak-request-resolved',
                payload: { peerId: peer.id, approved: false, cancelled: true } satisfies SpeakRequestResolvedNotification,
              });
            }
            send(ws, ok(req.id));
            break;
          }

          case 'approve-speaker': {
            const { room, peer: actor } = requireManager(conn);
            const target = targetPeer(room, req.payload as PeerTargetPayload);
            if (target.role === 'host') throw new Error('the host is already a speaker');
            if (target.role !== 'speaker') {
              target.role = 'speaker';
              room.speakerUserIds.add(target.userId);
              logger.info({ streamId: room.channelId, by: actor.userId, target: target.userId }, 'speaker approved');
              broadcastToRoom(room, null, {
                notification: 'role-changed',
                payload: { peerId: target.id, userId: target.userId, role: 'speaker' } satisfies RoleChangedNotification,
              });
            }
            room.pendingSpeakRequests.delete(target.id);
            const resolved: SpeakRequestResolvedNotification = { peerId: target.id, approved: true };
            sendToPeer(room, target.id, { notification: 'speak-request-resolved', payload: resolved });
            notifyManagers(room, { notification: 'speak-request-resolved', payload: resolved }, target.id);
            send(ws, ok(req.id));
            break;
          }

          case 'deny-speaker': {
            const { room } = requireManager(conn);
            const target = targetPeer(room, req.payload as PeerTargetPayload);
            if (!room.pendingSpeakRequests.delete(target.id)) throw new Error('no pending request from that peer');
            const cooldownMs = env.SPEAK_REQUEST_COOLDOWN_SEC * 1000;
            if (cooldownMs > 0) {
              const now = Date.now();
              for (const [uid, until] of room.speakCooldownUntil) if (until <= now) room.speakCooldownUntil.delete(uid);
              room.speakCooldownUntil.set(target.userId, now + cooldownMs);
            }
            const resolved: SpeakRequestResolvedNotification = {
              peerId: target.id,
              approved: false,
              ...(cooldownMs > 0 ? { retryAfterMs: cooldownMs } : {}),
            };
            sendToPeer(room, target.id, { notification: 'speak-request-resolved', payload: resolved });
            notifyManagers(room, { notification: 'speak-request-resolved', payload: resolved }, target.id);
            send(ws, ok(req.id));
            break;
          }

          case 'demote-speaker': {
            const { room, peer: actor } = requireManager(conn);
            const target = targetPeer(room, req.payload as PeerTargetPayload);
            if (target.role === 'host') throw new Error('the host cannot be demoted');
            if (target.role !== 'speaker') throw new Error('peer is not a speaker');
            target.role = 'listener';
            room.speakerUserIds.delete(target.userId);
            logger.info({ streamId: room.channelId, by: actor.userId, target: target.userId }, 'speaker demoted');
            closeSpeakerProducers(room, target);
            broadcastToRoom(room, null, {
              notification: 'role-changed',
              payload: { peerId: target.id, userId: target.userId, role: 'listener' } satisfies RoleChangedNotification,
            });
            send(ws, ok(req.id));
            break;
          }

          case 'remove-peer': {
            const { room, peer: actor } = requireManager(conn);
            const target = targetPeer(room, req.payload as PeerTargetPayload);
            if (target.role === 'host') throw new Error('the host cannot be removed');
            if (target.id === actor.id) throw new Error('you cannot remove yourself; use leave-room');
            const targetConn = connectionsByPeerId.get(target.id);
            if (!targetConn) throw new Error('peer not found');
            logger.info({ streamId: room.channelId, by: actor.userId, target: target.userId }, 'peer removed by manager');
            // Respond first: the actor's own reply must not depend on the target's teardown.
            send(ws, ok(req.id));
            removeConnection(targetConn, 'You were removed from this stream by the host.');
            break;
          }

          default:
            send(ws, fail(req.id, `unknown request type: ${req.type}`));
        }
      } catch (err) {
        if (err instanceof MediaError) {
          logger.warn({ code: err.code, type: req.type, userId: conn.userId }, `media request denied: ${err.message}`);
          send(ws, { id: req.id, ok: false, error: err.message, code: err.code, ...err.extra });
        } else {
          logger.error({ err, type: req.type }, 'media request failed');
          send(ws, fail(req.id, (err as Error).message));
        }
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      logger.info({ peerId: conn.peerId }, 'media socket disconnected');
      leaveRoom(conn);
      connectionsByPeerId.delete(conn.peerId);
    });
  });

  return wss;
}
