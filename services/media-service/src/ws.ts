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
} from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { roomManager, Room, Peer } from './rooms';
import { redis, PRESENCE_CHANNEL } from './redis';
import { publishPresence } from '@streaming/events';

interface Connection {
  ws: WebSocket;
  userId: string;
  username: string;
  peerId: string;
  room?: Room;
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

async function handleJoinRoom(conn: Connection, payload: JoinRoomPayload): Promise<JoinRoomResult> {
  const room = await roomManager.getOrCreateRoom(payload.channelId);
  const peer: Peer = {
    id: conn.peerId,
    userId: conn.userId,
    username: conn.username,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  const existingPeers = Array.from(room.peers.values()).map((p) => ({
    peerId: p.id,
    username: p.username,
    producers: Array.from(p.producers.values()).map((producer) => ({
      id: producer.id,
      kind: producer.kind,
      source: producerSource(producer),
    })),
  }));

  roomManager.addPeer(room, peer);
  conn.room = room;

  broadcastToRoom(room, conn.peerId, {
    notification: 'peer-joined',
    payload: { peerId: peer.id, username: peer.username } satisfies PeerJoinedNotification,
  });

  publishPresence(redis, PRESENCE_CHANNEL, {
    channelId: payload.channelId,
    peerId: peer.id,
    username: peer.username,
    event: 'joined',
  }).catch((err) => logger.warn({ err }, 'presence publish failed'));

  return { routerRtpCapabilities: room.router.rtpCapabilities, peers: existingPeers };
}

function broadcastToRoom(room: Room, exceptPeerId: string | null, msg: MediaNotification) {
  for (const peer of room.peers.values()) {
    if (peer.id === exceptPeerId) continue;
    const conn = connectionsByPeerId.get(peer.id);
    if (conn) send(conn.ws, msg);
  }
}

const connectionsByPeerId = new Map<string, Connection>();

function leaveRoom(conn: Connection) {
  if (!conn.room) return;
  const room = conn.room;
  roomManager.removePeer(room, conn.peerId);
  broadcastToRoom(room, conn.peerId, {
    notification: 'peer-left',
    payload: { peerId: conn.peerId } satisfies PeerLeftNotification,
  });
  publishPresence(redis, PRESENCE_CHANNEL, {
    channelId: room.channelId,
    peerId: conn.peerId,
    username: conn.username,
    event: 'left',
  }).catch((err) => logger.warn({ err }, 'presence publish failed'));
  conn.room = undefined;
}

export function createMediaWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/media' });

  wss.on('connection', (ws, req) => {
    let conn: Connection;
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) throw new Error('missing token');
      const claims = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      conn = { ws, userId: claims.sub, username: claims.username, peerId: uuidv4() };
      connectionsByPeerId.set(conn.peerId, conn);
      logger.info({ userId: conn.userId, peerId: conn.peerId }, 'media socket connected');
    } catch (err) {
      logger.warn({ err }, 'media socket auth failed');
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.on('message', async (raw) => {
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

            // Phase 1: one screen-share producer per user at a time. If they
            // already have one (e.g. re-sharing without the old one tearing
            // down cleanly), replace it rather than stacking producers.
            if (source === 'screen') {
              for (const existing of peer.producers.values()) {
                if (producerSource(existing) === 'screen') {
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

          default:
            send(ws, fail(req.id, `unknown request type: ${req.type}`));
        }
      } catch (err) {
        logger.error({ err, type: req.type }, 'media request failed');
        send(ws, fail(req.id, (err as Error).message));
      }
    });

    ws.on('close', () => {
      logger.info({ peerId: conn.peerId }, 'media socket disconnected');
      leaveRoom(conn);
      connectionsByPeerId.delete(conn.peerId);
    });
  });

  return wss;
}
