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
  ProducerSource,
  PeerInfo,
  PeerRole,
  SpeakRequestInfo,
  RoleChangedNotification,
  SpeakRequestedNotification,
  SpeakRequestResolvedNotification,
  RemovedNotification,
  MediaErrorCode,
} from '@streaming/shared-types';

import { sessionManager } from './sessionManager';
import { classifyJoinFailure, roomFullMessage, SHARED_ERRORS } from './errorMessages';

const MEDIA_WS_URL = import.meta.env.VITE_MEDIA_WS_URL ?? '/ws/media';

/** Media-service closes the socket with this code when the token was rejected at connect. */
const WS_CLOSE_UNAUTHORIZED = 4001;
const KEEPALIVE_INTERVAL_MS = 20_000;
const KEEPALIVE_TIMEOUT_MS = 10_000;

function resolveWsUrl(accessToken: string): string {
  if (MEDIA_WS_URL.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${MEDIA_WS_URL}?token=${encodeURIComponent(accessToken)}`;
  }
  const separator = MEDIA_WS_URL.includes('?') ? '&' : '?';
  return `${MEDIA_WS_URL}${separator}token=${encodeURIComponent(accessToken)}`;
}

/** A media-service request that failed, carrying the machine-readable code and extras the server sent. */
export class MediaRequestError extends Error {
  readonly code?: MediaErrorCode;
  readonly capacity?: { current: number; max: number };
  readonly retryAfterMs?: number;
  constructor(message: string, extra: { code?: MediaErrorCode; capacity?: { current: number; max: number }; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'MediaRequestError';
    this.code = extra.code;
    this.capacity = extra.capacity;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

/** User-facing text for a failed join-room (voice channel or stream). */
export function describeMediaJoinError(err: unknown): string {
  if (err instanceof MediaRequestError) {
    switch (err.code) {
      case 'room_full':
        return roomFullMessage(err.capacity);
      case 'forbidden':
        return "You don't have access to this room. If it's a private channel, you need to be a member.";
      case 'access_unavailable':
        return SHARED_ERRORS.access_unavailable;
      case 'banned':
        return SHARED_ERRORS.banned;
      case 'stream_ended':
        return SHARED_ERRORS.stream_ended;
      default:
        break;
    }
  }
  // Network / timeout / permission / unknown failures get friendly text, never raw error strings.
  const failure = classifyJoinFailure(err);
  if (failure.kind === 'other') return (err as Error)?.message && !/^request .* timed out$/.test((err as Error).message) ? (err as Error).message : failure.message;
  return failure.message;
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
  onPeerJoined: (peerId: string, username: string, info?: { userId: string; role: PeerRole }) => void;
  onPeerLeft: (peerId: string) => void;
  onError?: (message: string) => void;

  // --- Stream-mode notifications (all optional; plain voice channels never set them) ---
  /** A peer's role changed (approve / demote). Broadcast to the whole room, including to ourselves. */
  onRoleChanged?: (info: { peerId: string; userId: string; role: PeerRole }) => void;
  /** Host/admin only: a listener asked to speak. */
  onSpeakRequested?: (request: SpeakRequestInfo) => void;
  /** A speak request was approved / denied / cancelled (for us, or - for managers - for anyone). */
  onSpeakRequestResolved?: (info: { peerId: string; approved: boolean; cancelled?: boolean; retryAfterMs?: number }) => void;
  /** The server removed us (kick/ban/remove-peer); the socket closes right after. */
  onRemoved?: (reason: string) => void;
  onStreamEnded?: () => void;
  /** The signaling socket closed without us calling leave() (and without a `removed` notice first). */
  onDisconnected?: () => void;
  /** One of OUR producers was closed by the server (e.g. we were demoted). */
  onLocalProducerClosed?: (source: 'mic') => void;
}

/** Result of {@link VoiceClient.joinStream}. */
export interface StreamJoinResult {
  peers: PeerInfo[];
  you: JoinRoomResult['you'];
  stream?: JoinRoomResult['stream'];
  pendingSpeakRequests: SpeakRequestInfo[];
}

interface ConsumedProducerMeta {
  peerId: string;
  kind: ProducerKind;
  source: ProducerSource;
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
  private micProducer?: Producer;
  private sendTransportPromise?: Promise<void>;
  private joined = false;
  private leaving = false;
  private micGeneration = 0;
  private consumedProducers = new Set<string>();
  private consumedProducerMeta = new Map<string, ConsumedProducerMeta>();

  private constructor(ws: WebSocket, private callbacks: VoiceClientCallbacks) {
    this.ws = ws;
    this.ws.addEventListener('message', (event) => this.handleMessage(event));
    this.ws.addEventListener('close', (event) => {
      this.closeCode = event.code;
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
      const err = this.closedError();
      for (const pending of this.pendingRequests.values()) pending.reject(err);
      this.pendingRequests.clear();
      if (!this.leaving) this.callbacks.onDisconnected?.();
    });
    this.keepAliveTimer = setInterval(() => this.keepAlive(), KEEPALIVE_INTERVAL_MS);
  }

  private closeCode?: number;
  private keepAliveTimer?: ReturnType<typeof setInterval>;

  private closedError(): Error {
    if (this.closeCode === WS_CLOSE_UNAUTHORIZED) {
      return new MediaRequestError(SHARED_ERRORS.unauthorized, { code: 'unauthorized' as MediaErrorCode });
    }
    return new Error('connection closed');
  }

  /** Browsers cannot see WS ping frames, so probe with an app-level ping; a dead link is closed (-> onDisconnected -> reconnect). */
  private keepAlive() {
    if (this.ws.readyState !== WebSocket.OPEN || this.leaving) return;
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('keepalive timed out')), KEEPALIVE_TIMEOUT_MS));
    // Any reply (even an "unknown request" error from an older server) proves the link is alive; only silence counts.
    const probe = this.request('ping').catch((err) => {
      if (!(err instanceof MediaRequestError)) throw err;
    });
    Promise.race([probe, timeout]).catch(() => {
      if (!this.leaving && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    });
  }

  /**
   * Opens the signaling socket. `accessToken` is only a fallback: the LATEST token is
   * used (refreshing first when it is about to expire), so reconnects after a token
   * rotation never send a stale one.
   */
  static async connect(accessToken: string, callbacks: VoiceClientCallbacks): Promise<VoiceClient> {
    const token = (await sessionManager.ensureFresh().catch(() => null)) ?? sessionManager.getAccessToken() ?? accessToken;
    const ws = new WebSocket(resolveWsUrl(token));
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
      else {
        pending.reject(
          new MediaRequestError(msg.error ?? 'request failed', {
            code: msg.code,
            capacity: msg.capacity,
            retryAfterMs: msg.retryAfterMs,
          })
        );
      }
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
        const { peerId, username, userId, role } = msg.payload as PeerJoinedNotification;
        this.callbacks.onPeerJoined(peerId, username, userId && role ? { userId, role } : undefined);
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
        if (this.micProducer && this.micProducer.id === producerId) {
          // The server closed our own mic producer (we were demoted).
          this.releaseLocalMic();
          this.callbacks.onLocalProducerClosed?.('mic');
          break;
        }
        const meta = this.consumedProducerMeta.get(producerId);
        this.consumedProducerMeta.delete(producerId);
        this.consumedProducers.delete(producerId);
        if (meta?.kind === 'video') {
          this.callbacks.onRemoteScreenShareEnded(peerId);
        }
        break;
      }
      case 'role-changed':
        this.callbacks.onRoleChanged?.(msg.payload as RoleChangedNotification);
        break;
      case 'speak-requested':
        this.callbacks.onSpeakRequested?.(msg.payload as SpeakRequestedNotification);
        break;
      case 'speak-request-resolved':
        this.callbacks.onSpeakRequestResolved?.(msg.payload as SpeakRequestResolvedNotification);
        break;
      case 'removed':
        this.callbacks.onRemoved?.((msg.payload as RemovedNotification).reason);
        break;
      case 'stream-ended':
        this.callbacks.onStreamEnded?.();
        break;
      default:
        break;
    }
  }

  private request<T>(type: MediaRequest['type'], payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(this.closedError());
        return;
      }
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

  async joinAndPublish(channelId: string): Promise<{ peerId: string; username: string; userId: string }[]> {
    const { routerRtpCapabilities, peers } = await this.request<JoinRoomResult>('join-room', { channelId });
    await this.device.load({ routerRtpCapabilities: routerRtpCapabilities as any });

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.joined = true;

    await this.createSendTransport();
    const track = this.localStream.getAudioTracks()[0];
    await this.sendTransport!.produce({ track, appData: { source: 'mic' } });

    // Consume everyone who was already publishing before we joined.
    for (const peer of peers) {
      for (const producer of peer.producers) {
        this.consume(producer.id, peer.peerId, peer.username).catch((err) => this.callbacks.onError?.(err.message));
      }
    }

    return peers.map((p) => ({ peerId: p.peerId, username: p.username, userId: p.userId }));
  }

  // -------------------------------------------------------------------------
  // Stream mode (additive; the voice-channel flow above is unchanged)
  // -------------------------------------------------------------------------

  /**
   * Joins a stream's media room WITHOUT publishing anything (no mic prompt):
   * listeners never produce. Hosts/speakers call {@link startMic} afterwards.
   * Existing producers (mics, host screen-share) are consumed immediately.
   */
  async joinStream(channelId: string): Promise<StreamJoinResult> {
    const result = await this.request<JoinRoomResult>('join-room', { channelId });
    await this.device.load({ routerRtpCapabilities: result.routerRtpCapabilities as any });
    this.joined = true;

    for (const peer of result.peers) {
      for (const producer of peer.producers) {
        this.consume(producer.id, peer.peerId, peer.username).catch((err) => this.callbacks.onError?.(err.message));
      }
    }
    return {
      peers: result.peers,
      you: result.you,
      stream: result.stream,
      pendingSpeakRequests: result.pendingSpeakRequests ?? [],
    };
  }

  /** True while a mic producer is live. */
  get isMicLive(): boolean {
    return !!this.micProducer && !this.micProducer.closed;
  }

  /** The local mic stream (for level metering), if any. */
  get micStream(): MediaStream | undefined {
    return this.localStream;
  }

  /**
   * Prompts for the mic and publishes it. Throws on permission denial / server
   * rejection (e.g. role not allowed) so the caller can show a retry button.
   * `mutedInitially` keeps a previously-chosen mute across a re-start.
   */
  async startMic(mutedInitially = false): Promise<void> {
    if (this.isMicLive) return;
    if (!this.joined) throw new Error('not connected to the stream');
    const generation = ++this.micGeneration;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (generation !== this.micGeneration || this.leaving) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    try {
      await this.createSendTransport();
      const track = stream.getAudioTracks()[0];
      track.enabled = !mutedInitially;
      const producer = await this.sendTransport!.produce({ track, appData: { source: 'mic' } });
      if (generation !== this.micGeneration || this.leaving) {
        producer.close();
        this.request('close-producer', { producerId: producer.id }).catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.localStream = stream;
      this.micProducer = producer;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  /** Stops publishing the mic and releases the device. Safe to call when not live. */
  async stopMic(): Promise<void> {
    this.micGeneration++;
    const producer = this.micProducer;
    this.releaseLocalMic();
    if (producer && !producer.closed) {
      const producerId = producer.id;
      producer.close();
      try {
        await this.request('close-producer', { producerId });
      } catch {
        // best-effort - the server closes it when the peer leaves / is demoted
      }
    }
  }

  private releaseLocalMic() {
    this.micProducer = undefined;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = undefined;
  }

  requestToSpeak(): Promise<void> {
    return this.request<void>('request-speak');
  }
  cancelSpeakRequest(): Promise<void> {
    return this.request<void>('cancel-speak-request');
  }
  approveSpeaker(peerId: string): Promise<void> {
    return this.request<void>('approve-speaker', { peerId });
  }
  denySpeaker(peerId: string): Promise<void> {
    return this.request<void>('deny-speaker', { peerId });
  }
  demoteSpeaker(peerId: string): Promise<void> {
    return this.request<void>('demote-speaker', { peerId });
  }
  /** Unrecorded kick (the user can rejoin). For recorded kick/ban use the REST moderation endpoint. */
  removePeer(peerId: string): Promise<void> {
    return this.request<void>('remove-peer', { peerId });
  }

  /** Idempotent and safe to call concurrently (concurrent starters share one transport). */
  private createSendTransport(): Promise<void> {
    if (this.sendTransport) return Promise.resolve();
    if (!this.sendTransportPromise) {
      this.sendTransportPromise = this.doCreateSendTransport().finally(() => {
        this.sendTransportPromise = undefined;
      });
    }
    return this.sendTransportPromise;
  }

  private async doCreateSendTransport() {
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
      const source = (appData as { source?: ProducerSource })?.source ?? 'mic';
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

    this.consumedProducerMeta.set(producerId, { peerId, kind: result.kind, source: result.source });

    const stream = new MediaStream([consumer.track]);
    if (result.kind === 'video') {
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
    if (!this.sendTransport) {
      // Stream hosts join without a send transport until they publish; create it on demand.
      if (!this.joined) throw new Error('not connected to voice');
      await this.createSendTransport();
    }
    if (this.screenProducer) return this.screenStream!;

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    this.screenStream = stream;
    this.screenProducer = await this.sendTransport!.produce({ track, appData: { source: 'screen' } });

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
    this.leaving = true;
    this.micGeneration++;
    try {
      await this.request('leave-room');
    } catch {
      // best-effort
    }
    await this.stopScreenShare();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.sendTransport?.close();
    this.recvTransport?.close();
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
    this.ws.close();
  }
}
