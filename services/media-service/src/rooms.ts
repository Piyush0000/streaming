import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
} from 'mediasoup/node/lib/types';
import type { PeerRole } from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';

// `preferredPayloadType` is typed as mandatory but is documented as optional
// specifically within RouterOptions.mediaCodecs (mediasoup picks one itself
// when omitted), hence the cast.
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  // VP8 for camera and screen-share video: widely supported, royalty-free, no
  // licensing complexity (unlike H264). One video codec is enough.
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
  },
] as unknown as mediasoup.types.RtpCodecCapability[];

export interface Peer {
  id: string;
  userId: string;
  username: string;
  /** Plain voice channels: everyone is 'speaker'. Streams: host | speaker | listener. */
  role: PeerRole;
  /** Platform admin (STREAM_ADMIN_EMAILS) — may manage speakers in stream rooms. */
  isAdmin: boolean;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface RoomMeta {
  isStream: boolean;
  hostId?: string;
  hostUsername?: string;
  title?: string;
}

export interface Room extends RoomMeta {
  channelId: string;
  worker: Worker;
  router: Router;
  peers: Map<string, Peer>;
  /** Stream rooms: peerIds with an open request-to-speak. */
  pendingSpeakRequests: Set<string>;
  /** Stream rooms: userIds approved to speak, so a reconnect keeps the role while the room lives. */
  speakerUserIds: Set<string>;
  /** Stream rooms: userId -> epoch ms until which a denied listener may not ask to speak again. */
  speakCooldownUntil: Map<string, number>;
}

/** Unique users currently in the room (one user with several tabs counts once). */
export function uniqueUserCount(room: Room): number {
  const ids = new Set<string>();
  for (const p of room.peers.values()) ids.add(p.userId);
  return ids.size;
}

export function hasUser(room: Room, userId: string): boolean {
  for (const p of room.peers.values()) if (p.userId === userId) return true;
  return false;
}

/**
 * One mediasoup Worker + Router per voice room. Created on first join,
 * torn down when the last peer leaves. Rooms are purely in-memory: they are
 * rebuildable state, never the source of truth for anything (channels
 * themselves live in Postgres, owned by api-service).
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  private creating = new Map<string, Promise<Room>>();

  /** Concurrent first joins share one creation so we never build two workers for a room. */
  getOrCreateRoom(channelId: string, meta: RoomMeta): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) return Promise.resolve(existing);
    const inFlight = this.creating.get(channelId);
    if (inFlight) return inFlight;
    const p = this.createRoom(channelId, meta).finally(() => this.creating.delete(channelId));
    this.creating.set(channelId, p);
    return p;
  }

  private async createRoom(channelId: string, meta: RoomMeta): Promise<Room> {
    const worker = await mediasoup.createWorker({
      rtcMinPort: env.MEDIASOUP_MIN_PORT,
      rtcMaxPort: env.MEDIASOUP_MAX_PORT,
    });
    worker.on('died', () => {
      logger.error({ channelId }, 'mediasoup worker died unexpectedly, tearing down room');
      this.rooms.delete(channelId);
    });

    const router = await worker.createRouter({ mediaCodecs });

    const room: Room = {
      ...meta,
      channelId,
      worker,
      router,
      peers: new Map(),
      pendingSpeakRequests: new Set(),
      speakerUserIds: new Set(),
      speakCooldownUntil: new Map(),
    };
    this.rooms.set(channelId, room);
    logger.info({ channelId, isStream: meta.isStream }, 'created voice room');
    return room;
  }

  getRoom(channelId: string): Room | undefined {
    return this.rooms.get(channelId);
  }

  addPeer(room: Room, peer: Peer): void {
    room.peers.set(peer.id, peer);
  }

  removePeer(room: Room, peerId: string): void {
    const peer = room.peers.get(peerId);
    if (!peer) return;

    for (const consumer of peer.consumers.values()) consumer.close();
    for (const producer of peer.producers.values()) producer.close();
    for (const transport of peer.transports.values()) transport.close();

    room.peers.delete(peerId);
    room.pendingSpeakRequests.delete(peerId);

    if (room.peers.size === 0) {
      this.closeRoom(room);
      logger.info({ channelId: room.channelId }, 'closed empty voice room');
    }
  }

  /** Tears down a room nobody ended up joining (e.g. the joiner disconnected mid-setup). */
  closeIfEmpty(room: Room): void {
    if (room.peers.size === 0) this.closeRoom(room);
  }

  private closeRoom(room: Room): void {
    // Guard against a stale reference closing a newer room with the same id.
    if (this.rooms.get(room.channelId) === room) this.rooms.delete(room.channelId);
    room.router.close();
    room.worker.close();
  }

  async createWebRtcTransport(room: Room): Promise<WebRtcTransport> {
    return room.router.createWebRtcTransport({
      listenIps: [{ ip: env.MEDIASOUP_LISTEN_IP, announcedIp: env.MEDIASOUP_ANNOUNCED_IP }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }
}

export const roomManager = new RoomManager();
