import { Device } from 'mediasoup-client';
import type { Transport } from 'mediasoup-client/types';
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

export interface VoiceClientCallbacks {
  onRemoteStream: (peer: RemotePeerAudio) => void;
  onPeerLeft: (peerId: string) => void;
  onError?: (message: string) => void;
}

/**
 * Thin client around the media-service signaling WebSocket + mediasoup-client,
 * following the standard mediasoup-demo produce/consume flow, minimal audio-only.
 */
export class VoiceClient {
  private ws: WebSocket;
  private device = new Device();
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private localStream?: MediaStream;
  private consumedProducers = new Set<string>();

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
        const { username } = msg.payload as PeerJoinedNotification;
        // eslint-disable-next-line no-console
        console.log(`${username} joined the voice channel`);
        break;
      }
      case 'peer-left': {
        const { peerId } = msg.payload as PeerLeftNotification;
        this.callbacks.onPeerLeft(peerId);
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
    await this.sendTransport!.produce({ track });

    // Consume everyone who was already publishing before we joined.
    for (const peer of peers) {
      for (const producerId of peer.producerIds) {
        this.consume(producerId, peer.peerId, peer.username).catch((err) => this.callbacks.onError?.(err.message));
      }
    }

    return peers;
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

    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      this.request<ProduceResult>('produce', { transportId: transport.id, kind, rtpParameters })
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

    const stream = new MediaStream([consumer.track]);
    this.callbacks.onRemoteStream({ peerId, username, stream });
  }

  /** Mute/unmute the local mic by toggling the outgoing audio track — additive, doesn't touch signaling. */
  setMicMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  async leave() {
    try {
      await this.request('leave-room');
    } catch {
      // best-effort
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.ws.close();
  }
}
