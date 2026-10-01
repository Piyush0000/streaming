import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
} from 'mediasoup/node/lib/types';
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
  // VP8 for screen-share video: widely supported, royalty-free, no licensing
  // complexity (unlike H264). Phase 1 only needs one video codec.
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
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface Room {
  channelId: string;
  worker: Worker;
  router: Router;
  peers: Map<string, Peer>;
}

/**
 * One mediasoup Worker + Router per voice room. Created on first join,
 * torn down when the last peer leaves. Rooms are purely in-memory: they are
 * rebuildable state, never the source of truth for anything (channels
 * themselves live in Postgres, owned by api-service).
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  async getOrCreateRoom(channelId: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) return existing;

    const worker = await mediasoup.createWorker({
      rtcMinPort: env.MEDIASOUP_MIN_PORT,
      rtcMaxPort: env.MEDIASOUP_MAX_PORT,
    });
    worker.on('died', () => {
      logger.error({ channelId }, 'mediasoup worker died unexpectedly, tearing down room');
      this.rooms.delete(channelId);
    });

    const router = await worker.createRouter({ mediaCodecs });

    const room: Room = { channelId, worker, router, peers: new Map() };
    this.rooms.set(channelId, room);
    logger.info({ channelId }, 'created voice room');
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

    if (room.peers.size === 0) {
      room.router.close();
      room.worker.close();
      this.rooms.delete(room.channelId);
      logger.info({ channelId: room.channelId }, 'closed empty voice room');
    }
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
