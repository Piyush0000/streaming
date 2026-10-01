import { Device } from 'mediasoup-client';
import type { Transport, Producer } from 'mediasoup-client/types';
import type {
  MediaRequest,
  MediaResponse,
  MediaNotification,
  JoinRoomResult,
  CreateWebRtcTransportResult,
  ProduceResult,
  ConsumeResult,
  NewProducerNotification,
  PeerJoinedNotification,
  PeerLeftNotification,
  ProducerClosedNotification,
  ProducerKind,
} from '@streaming/shared-types';

const MEDIA_WS_URL = import.meta.env.VITE_MEDIA_WS_URL ?? '/ws/media';

function resolveWsUrl(accessToken: string): string {
  if (MEDIA_WS_URL.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${MEDIA_WS_URL}?token=${encodeURIComponent(accessToken)}`;
  }
  const separator = MEDIA_WS_URL.includes('?') ? '&' : '?';
  return `${MEDIA_WS_URL}${separator}token=${encodeURIComponent(accessToken)}`;
}

export interface RemotePeerAudio {
  peerId: string;
  username: string;
  stream: MediaStream;
}

export interface RemotePeerVideo {
  peerId: string;
  username: string;
  stream: MediaStream;
  producerId: string;
}

export interface VoiceClientCallbacks {
  onRemoteStream: (peer: RemotePeerAudio) => void;
  onRemoteScreenShare: (peer: RemotePeerVideo) => void;
  onRemoteScreenShareEnded: (peerId: string) => void;
  /** A peer joined this voice room after we did (not the initial roster on our own join). */
  onPeerJoined: (peerId: string, username: string) => void;
  onPeerLeft: (peerId: string) => void;
  onError?: (message: string) => void;
}

interface ConsumedProducerMeta {
  peerId: string;
  kind: ProducerKind;
}

/**
 * Thin client around the media-service signaling WebSocket + mediasoup-client,
 * following the standard mediasoup-demo produce/consume flow. Audio (mic) is
 * always produced on join; a second, optional video producer carries a
 * screen-share when the user starts one.
 */
export class VoiceClient {
  private ws: WebSocket;
  private device = new Device();
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private localStream?: MediaStream;
  private screenStream?: MediaStream;
  private screenProducer?: Producer;
  private consumedProducers = new Set<string>();
  private consumedProducerMeta = new Map<string, ConsumedProducerMeta>();

  private constructor(ws: WebSocket, private callbacks: VoiceClientCallbacks) {
    this.ws = ws;
    this.ws.addEventListener('message', (event) => this.handleMessage(event));
  }

  static async connect(accessToken: string, callbacks: VoiceClientCallbacks): Promise<VoiceClient> {
    const ws = new WebSocket(resolveWsUrl(accessToken));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('media socket failed to connect')), { once: true });
    });
    return new VoiceClient(ws, callbacks);
  }

  private handleMessage(event: MessageEvent) {
    const msg = JSON.parse(event.data) as MediaResponse | MediaNotification;
    if ('id' in msg) {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);
      if (msg.ok) pending.resolve(msg.payload);
      else pending.reject(new Error(msg.error ?? 'request failed'));
      return;
    }
    this.handleNotification(msg);
  }

  private handleNotification(msg: MediaNotification) {
    switch (msg.notification) {
      case 'new-producer': {
        const { producerId, peerId, username } = msg.payload as NewProducerNotification;
        this.consume(producerId, peerId, username).catch((err) => this.callbacks.onError?.(err.message));
        break;
      }
      case 'peer-joined': {
        const { peerId, username } = msg.payload as PeerJoinedNotification;
        this.callbacks.onPeerJoined(peerId, username);
        break;
      }
      case 'peer-left': {
        const { peerId } = msg.payload as PeerLeftNotification;
        // A peer's screen-share tile (if any) might not get an explicit
        // producer-closed notification before this depending on message
        // ordering, so clean it up defensively here too.
        this.callbacks.onRemoteScreenShareEnded(peerId);
        this.callbacks.onPeerLeft(peerId);
        break;
      }
      case 'producer-closed': {
        const { producerId, peerId } = msg.payload as ProducerClosedNotification;
        const meta = this.consumedProducerMeta.get(producerId);
        this.consumedProducerMeta.delete(producerId);
        this.consumedProducers.delete(producerId);
        if (meta?.kind === 'video') {
          this.callbacks.onRemoteScreenShareEnded(peerId);
        }
        break;
      }
      default:
        break;
    }
  }

  private request<T>(type: MediaRequest['type'], payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, type, payload } satisfies MediaRequest));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`request ${type} timed out`));
        }
      }, 15000);
    });
  }

  async joinAndPublish(channelId: string): Promise<{ peerId: string; username: string }[]> {
    const { routerRtpCapabilities, peers } = await this.request<JoinRoomResult>('join-room', { channelId });
    await this.device.load({ routerRtpCapabilities: routerRtpCapabilities as any });

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    await this.createSendTransport();
    const track = this.localStream.getAudioTracks()[0];
    await this.sendTransport!.produce({ track, appData: { source: 'mic' } });

    // Consume everyone who was already publishing before we joined.
    for (const peer of peers) {
      for (const producer of peer.producers) {
        this.consume(producer.id, peer.peerId, peer.username).catch((err) => this.callbacks.onError?.(err.message));
      }
    }

    return peers.map((p) => ({ peerId: p.peerId, username: p.username }));
  }

  private async createSendTransport() {
    const params = await this.request<CreateWebRtcTransportResult>('create-webrtc-transport', {
      direction: 'send',
    });
    const transport = this.device.createSendTransport({
      id: params.id,
      iceParameters: params.iceParameters as any,
      iceCandidates: params.iceCandidates as any,
      dtlsParameters: params.dtlsParameters as any,
    });

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connect-webrtc-transport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });

    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      const source = (appData as { source?: 'mic' | 'screen' })?.source ?? 'mic';
      this.request<ProduceResult>('produce', { transportId: transport.id, kind, rtpParameters, source })
        .then(({ id }) => callback({ id }))
        .catch(errback);
    });

    this.sendTransport = transport;
  }

  private async ensureRecvTransport(): Promise<Transport> {
    if (this.recvTransport) return this.recvTransport;

    const params = await this.request<CreateWebRtcTransportResult>('create-webrtc-transport', {
      direction: 'recv',
    });
    const transport = this.device.createRecvTransport({
      id: params.id,
      iceParameters: params.iceParameters as any,
      iceCandidates: params.iceCandidates as any,
      dtlsParameters: params.dtlsParameters as any,
    });

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connect-webrtc-transport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });

    this.recvTransport = transport;
    return transport;
  }

  private async consume(producerId: string, peerId: string, username: string) {
    if (this.consumedProducers.has(producerId)) return;
    this.consumedProducers.add(producerId);

    const transport = await this.ensureRecvTransport();
    const result = await this.request<ConsumeResult>('consume', {
      transportId: transport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    const consumer = await transport.consume({
      id: result.id,
      producerId: result.producerId,
      kind: result.kind,
      rtpParameters: result.rtpParameters as any,
    });

    await this.request('resume-consumer', { consumerId: consumer.id });

    this.consumedProducerMeta.set(producerId, { peerId, kind: result.kind });

    const stream = new MediaStream([consumer.track]);
    if (result.kind === 'video' && result.source === 'screen') {
      this.callbacks.onRemoteScreenShare({ peerId, username, stream, producerId });
    } else {
      this.callbacks.onRemoteStream({ peerId, username, stream });
    }
  }

  /** Mute/unmute the local mic by toggling the outgoing audio track — additive, doesn't touch signaling. */
  setMicMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  get isScreenSharing(): boolean {
    return !!this.screenProducer;
  }

  /**
   * Starts a screen-share: grabs a display-media video track and produces it
   * on the existing send transport (one extra producer alongside the mic).
   * The browser's own share-picker can be cancelled by the user, which
   * rejects getDisplayMedia's promise — callers should treat that as a
   * silent no-op, not an error (same pattern as other user-cancel paths in
   * this codebase).
   */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.sendTransport) throw new Error('not connected to voice');
    if (this.screenProducer) return this.screenStream!;

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    this.screenStream = stream;
    this.screenProducer = await this.sendTransport.produce({ track, appData: { source: 'screen' } });

    // Fires when the user stops sharing via the browser's own "Stop sharing"
    // chrome/toolbar, bypassing our button entirely.
    track.addEventListener('ended', () => {
      this.stopScreenShare().catch(() => {});
    });

    return stream;
  }

  async stopScreenShare(): Promise<void> {
    const producer = this.screenProducer;
    this.screenProducer = undefined;
    if (producer && !producer.closed) {
      const producerId = producer.id;
      producer.close();
      try {
        await this.request('close-producer', { producerId });
      } catch {
        // best-effort — server will also clean this up when the peer leaves
      }
    }
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = undefined;
  }

  async leave() {
    try {
      await this.request('leave-room');
    } catch {
      // best-effort
    }
    await this.stopScreenShare();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.ws.close();
  }
}
